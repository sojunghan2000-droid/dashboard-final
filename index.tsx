// index.tsx 파일의 내용을 아래 코드로 완전히 교체하거나, 해당 부분만 수정하세요.

import React, { Component, useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';

// --- Type Definitions ---
import type {
  UserRole,
  Reply,
  Issue,
  Period,
  Revision,
  TaskStatus,
  Task,
  Member,
  UserContextType,
  Group,
  Team,
  Department,
  Organization,
  CategoryMaster,
  SampleData,
  ViewType,
  SortKey,
  SortConfig,
  Notification,
  UploadError,
  UploadPreview
} from './types';

// --- Data & Mappings ---
import { 
  categoryMasterData, 
  categoryCodeMapping, 
  obsCodeMapping,
  organizationData, 
  sampleData 
} from './data';

// --- Utilities ---
import { calculateWorkingDays, koreanHolidays, numberToHHMM, hhmmToNumber, validateHHMM, normalizeHHMM, normalizeFlexibleHHMMInput } from './utils';

// --- Components ---
import { TaskRegistrationModal } from './TaskRegistrationModal';
import { generateTaskCodeForTask2 } from './taskCode';

// --- External Libraries ---
import * as XLSX from 'xlsx';

declare const Chart: any;

// Task Code 출력 포맷 통일: DI-AI-NLP-PL01.02.04.01 형태(숫자 구간 2자리 패딩)
const formatTaskCode = (code: string): string => {
  const raw = String(code || '').trim();
  const m = raw.match(/^([^-]+-[^-]+-[^-]+)-([A-Za-z0-9]+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return raw;
  const [, org, cat1, a, b, c] = m;
  const aN = parseInt(a, 10);
  const bN = parseInt(b, 10);
  const cN = parseInt(c, 10);
  if ([aN, bN, cN].some(x => Number.isNaN(x))) return raw;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${org}-${cat1}.${pad2(aN)}.${pad2(bN)}.${pad2(cN)}`;
};

const normalizeTaskCodeKey = (code: string): string => {
  const formatted = formatTaskCode(code || '');
  return String(formatted).trim().toUpperCase();
};

const parseRegistration = (value: string | undefined | null): { prefix: 'R' | 'NR'; n: number } | null => {
  const s = String(value ?? '').trim().toUpperCase();
  // Accept "R.1" and "R1" (and legacy "NR.1"/"NR1")
  const m = s.match(/^(NR|R)\.?(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[2], 10);
  if (Number.isNaN(n)) return null;
  return { prefix: (m[1] as 'R' | 'NR'), n };
};

const getTaskRegistrationLabel = (task: Task): string => {
  const v = String(task.registration ?? '').trim();
  if (v) return v;
  const createdVia = task.createdVia ?? 'unknown';
  if (createdVia === 'manual') return '추가';
  const createdByRole = task.createdByRole ?? 'admin';
  if (createdByRole !== 'admin') return '추가';
  return `R.${task.revisions?.length ?? 0}`;
};

// Task 상세 현황에서 Task Code 중복 시 "최신" 1건만 남김
const dedupeTasksByLatestRegistration = (tasks: Task[]): Task[] => {
  const getScore = (t: Task) => {
    const parsed = parseRegistration(t.registration);
    if (parsed) return { tier: parsed.prefix === 'R' ? 2 : 1, n: parsed.n, rev: t.revisions?.length ?? 0 };
    return { tier: 0, n: -1, rev: t.revisions?.length ?? 0 };
  };
  const isNewer = (a: Task, b: Task) => {
    const sa = getScore(a);
    const sb = getScore(b);
    if (sa.tier !== sb.tier) return sa.tier > sb.tier;
    if (sa.n !== sb.n) return sa.n > sb.n;
    if (sa.rev !== sb.rev) return sa.rev > sb.rev;
    // 마지막 tie-breaker: 이슈/ID
    const ia = a.monthlyIssues?.length ?? 0;
    const ib = b.monthlyIssues?.length ?? 0;
    if (ia !== ib) return ia > ib;
    return String(a.id) > String(b.id);
  };

  const map = new Map<string, Task>();
  for (const t of tasks) {
    const key = (t.taskCode || '').trim();
    // Task Code가 없으면 중복 제거 대상이 아니므로 id로 분리
    const dedupeKey = key ? `code:${key}` : `id:${t.id}`;
    const prev = map.get(dedupeKey);
    if (!prev || isNewer(t, prev)) map.set(dedupeKey, t);
  }
  return Array.from(map.values());
};

const makeUniqueTask2Name = (existingTasks: Task[], assigneeId: string, proposedName: string): string => {
  const raw = String(proposedName ?? '').trim();
  if (!raw) return raw;
  const base = raw.replace(/\s*#\d+\s*$/, '').trim();
  const candidates = existingTasks.filter(t => t.assignee === assigneeId);
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*#(\\d+)\\s*$`);
  let maxSuffix = -1;
  let baseExists = false;
  for (const t of candidates) {
    const name = String(t.name ?? '').trim();
    if (name === base) baseExists = true;
    const m = name.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > maxSuffix) maxSuffix = n;
    }
  }
  if (!baseExists && maxSuffix < 0) return raw;
  const next = Math.max(maxSuffix, baseExists ? 0 : -1) + 1; // 첫 중복은 #1
  return `${base} #${next}`;
};

const setTextFormatForColumns = (ws: any, colIdxs: number[], opts?: { ensureRows?: number }) => {
  if (!ws) return;
  const ensureRows = opts?.ensureRows ?? 0;
  const ref = ws['!ref'] || 'A1:A1';
  const range = XLSX.utils.decode_range(ref);

  const startDataRow = 4; // Row 5 (0-based). Row 4 is header.
  const endRow = ensureRows > 0 ? Math.max(range.e.r, startDataRow + ensureRows) : range.e.r;

  for (let r = startDataRow; r <= endRow; r++) {
    for (const c of colIdxs) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) {
        if (ensureRows > 0) ws[addr] = { t: 's', v: '' };
        else continue;
      }
      // Excel에서 자동 변환 방지: 텍스트 서식 + 문자열 타입
      ws[addr].z = '@';
      if (ws[addr].t !== 's') {
        ws[addr].t = 's';
        ws[addr].v = ws[addr].v != null ? String(ws[addr].v) : '';
      }
    }
  }

  if (ensureRows > 0 && endRow > range.e.r) {
    range.e.r = endRow;
    ws['!ref'] = XLSX.utils.encode_range(range);
  }
};

const STORAGE_KEYS = {
  organization: 'pm_dashboard_organization_v1',
  tasks: 'pm_dashboard_tasks_v1',
  user: 'pm_dashboard_user_v1',
  uiState: 'pm_dashboard_ui_state_v1'
} as const;

const saveOrganizationToLocal = (organization: Organization) => {
  try {
    window.localStorage.setItem(STORAGE_KEYS.organization, JSON.stringify(organization));
    alert('저장되었습니다. (브라우저에 저장)');
  } catch (e) {
    console.error('Save failed:', e);
    alert('저장 중 오류가 발생했습니다.');
  }
};

// Tasks 데이터 저장
const saveTasksToLocal = (tasks: Task[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks));
  } catch (e) {
    console.error('Tasks save failed:', e);
  }
};

// Tasks 데이터 로드
const loadTasksFromLocal = (): Task[] | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEYS.tasks);
      if (saved) {
        return JSON.parse(saved) as Task[];
      }
    }
  } catch (e) {
    console.warn('Failed to load tasks from localStorage:', e);
  }
  return null;
};

// 사용자 상태 저장 (sessionStorage - 브라우저 닫으면 사라짐)
const saveUserToSession = (user: UserContextType) => {
  try {
    if (user) {
      window.sessionStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEYS.user);
    }
  } catch (e) {
    console.error('User save failed:', e);
  }
};

// 사용자 상태 로드
const loadUserFromSession = (): UserContextType | null => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const saved = window.sessionStorage.getItem(STORAGE_KEYS.user);
      if (saved) {
        return JSON.parse(saved) as UserContextType;
      }
    }
  } catch (e) {
    console.warn('Failed to load user from sessionStorage:', e);
  }
  return null;
};

// UI 상태 타입 정의
type UIState = {
  currentMainView?: 'dashboard' | 'taskList' | 'calendar' | 'admin';
  currentView?: ViewType;
  filters?: { team: string; group: string; member: string };
  filterStartMonth?: string;
  filterEndMonth?: string;
  statusFilter?: string;
  sortConfig?: SortConfig[];
  showInactive?: boolean;
  excludeCompleted?: boolean;
  taskSearchQuery?: string;
  taskTableColumnWidths?: number[];
  calendarDate?: string; // ISO string
  isSidebarCollapsed?: boolean;
};

// UI 상태 저장
const saveUIStateToLocal = (state: UIState) => {
  try {
    window.localStorage.setItem(STORAGE_KEYS.uiState, JSON.stringify(state));
  } catch (e) {
    console.error('UI state save failed:', e);
  }
};

// UI 상태 로드
const loadUIStateFromLocal = (): UIState | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEYS.uiState);
      if (saved) {
        return JSON.parse(saved) as UIState;
      }
    }
  } catch (e) {
    console.warn('Failed to load UI state from localStorage:', e);
  }
  return null;
};

// -----------------------------------------------------------------------------
// Global Error Overlay (to debug blank-screen runtime crashes)
// -----------------------------------------------------------------------------
type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { error: unknown | null; info?: React.ErrorInfo };

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info);
    this.setState({ error, info });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg =
      this.state.error instanceof Error
        ? this.state.error.stack || this.state.error.message
        : String(this.state.error);

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: '#fff',
          color: '#111',
          padding: '24px',
          overflow: 'auto',
          zIndex: 999999
        }}
      >
        <h2 style={{ marginTop: 0 }}>화면 렌더링 중 오류가 발생했습니다</h2>
        <p style={{ marginTop: 8, color: '#b00020', fontWeight: 700 }}>
          아래 오류 메시지를 복사해서 보내주시면 바로 수정할게요.
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12, borderRadius: 8 }}>
          {msg}
        </pre>
      </div>
    );
  }
}

// Also capture non-React errors
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    // eslint-disable-next-line no-console
    console.error('window.onerror:', e.error || e.message, e);
  });
  window.addEventListener('unhandledrejection', (e) => {
    // eslint-disable-next-line no-console
    console.error('unhandledrejection:', (e as any).reason, e);
  });
}





















// --- Utils ---
const dateDiffInDays = (dateStr1: string, dateStr2: string) => { const dt1 = new Date(dateStr1); const dt2 = new Date(dateStr2); dt1.setHours(0, 0, 0, 0); dt2.setHours(0, 0, 0, 0); return Math.floor((dt1.getTime() - dt2.getTime()) / (1000 * 60 * 60 * 24)); };

const getCurrentPlan = (task: Task) => { if (task.revisions.length > 0) return task.revisions[task.revisions.length - 1].period; return task.planned; };

const distributeHoursByMonth = (start: string | null, end: string | null, totalHours: string, year: number) => { const distribution = Array(12).fill(0); if (!start || !end || !totalHours) return distribution; const hoursNum = hhmmToNumber(totalHours); if (hoursNum <= 0) return distribution; const s = new Date(start); const e = new Date(end); if (s > e) return distribution; const oneDay = 24 * 60 * 60 * 1000; const diffDays = Math.max(1, Math.round(Math.abs((e.getTime() - s.getTime()) / oneDay)) + 1); const hoursPerDay = hoursNum / diffDays; let current = new Date(s); while (current <= e) { if (current.getFullYear() === year) { distribution[current.getMonth()] += hoursPerDay; } current.setDate(current.getDate() + 1); } return distribution.map(h => Math.round(h)); };

const filterTasksByDateRange = (tasks: Task[], startMonth: string, endMonth: string) => { if (!startMonth || !endMonth) return tasks; return tasks.filter(t => { const currentPlan = getCurrentPlan(t); const pStart = currentPlan.startDate ? currentPlan.startDate.substring(0, 7) : ''; const pEnd = currentPlan.endDate ? currentPlan.endDate.substring(0, 7) : ''; if (!pStart || !pEnd) return false; return pStart >= startMonth && pEnd <= endMonth; }); };


// --- Auth Helpers ---
const getAccessibleTasks = (user: UserContextType, allTasks: Task[], org: Organization): Task[] => {
  if (!user) return [];
  const isDirector =
    user.role === 'dept_head' || (typeof user.position === 'string' && user.position.includes('실장'));
  if (user.role === 'admin') return allTasks;

  // 실장: 본인 실(Department) 전체
  if (isDirector) {
    const deptName = user.departmentId
      ? org.departments.find(d => d.id === user.departmentId)?.name
      : null;
    if (!deptName) return allTasks;
    return allTasks.filter(t => t.department === deptName);
  }

  if (user.role === 'team_leader') {
    const myTeamName = org.departments.flatMap(d => d.teams).find(t => t.id === user.teamId)?.name;
    return allTasks.filter(t => t.team === myTeamName);
  }
  if (user.role === 'group_leader') {
    const myGroupName = org.departments.flatMap(d => d.teams.flatMap(t => t.groups)).find(g => g.id === user.groupId)?.name;
    return allTasks.filter(t => t.group === myGroupName);
  }
  return allTasks.filter(t => t.assignee === user.id);
};

const canReviewTask = (user: UserContextType, task: Task, org: Organization): boolean => {
  if (!user) return false;
  const isDirector =
    user.role === 'dept_head' || (typeof user.position === 'string' && user.position.includes('실장'));
  if (user.role === 'admin') return true;
  if (isDirector) {
    const deptName = user.departmentId
      ? org.departments.find(d => d.id === user.departmentId)?.name
      : null;
    if (deptName && task.department === deptName) return true;
  }
  if (user.role === 'team_leader' && task.team === org.departments.flatMap(d => d.teams).find(t => t.id === user.teamId)?.name) return true;
  if (user.role === 'group_leader' && task.group === org.departments.flatMap(d => d.teams.flatMap(t => t.groups)).find(g => g.id === user.groupId)?.name) return true;
  return false;
};

// --- Components ---
const LoginView = ({ onLogin, organization }: { onLogin: (user: UserContextType) => void, organization: Organization }) => {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const idInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 컴포넌트가 마운트될 때 아이디 입력 필드에 자동 포커스
    if (idInputRef.current) {
      idInputRef.current.focus();
    }
  }, []);

  const handleLogin = () => {
    // 1. 하드코딩된 슈퍼 어드민 (비상용)
    if (id === 'admin' && pw === 'admin') {
      onLogin({
        id: 'super_admin',
        name: '시스템관리자',
        position: '관리자',
        loginId: 'admin',
        password: '',
        role: 'admin'
      });
      return;
    }

    // 2. 조직도 내 멤버 검색
    let foundUser: UserContextType = null;
    
    outerLoop:
    for (const dept of organization.departments) {
      for (const team of dept.teams) {
        for (const group of team.groups) {
          const member = group.members.find(m => m.loginId === id && m.password === pw);
          if (member) {
            foundUser = { ...member, departmentId: dept.id, teamId: team.id, groupId: group.id };
            break outerLoop;
          }
        }
      }
    }

    if (foundUser) {
      onLogin(foundUser);
    } else {
      setError('아이디 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h2 className="login-title">S-Core Flow</h2>
        <div className="form-group">
          <label className="form-label">아이디</label>
          <input 
            ref={idInputRef}
            type="text" 
            className="form-input" 
            value={id} 
            onChange={e => setId(e.target.value)} 
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="아이디를 입력하세요"
          />
        </div>
        <div className="form-group">
          <label className="form-label">비밀번호</label>
          <input 
            type="password" 
            className="form-input" 
            value={pw} 
            onChange={e => setPw(e.target.value)} 
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="비밀번호를 입력하세요"
          />
        </div>
        {error && <p style={{ color: '#dc3545', fontSize: '0.9rem', marginTop: '-10px', marginBottom: '15px' }}>{error}</p>}
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }} onClick={handleLogin}>
          로그인
        </button>
        <div className="login-help">
          * 초기 계정: 사번 / 1234<br/>
          * 관리자: admin / admin<br/>
      
        </div>
      </div>
    </div>
  );
};







const ChartCanvas = React.memo(({ type, data, options, height, plugins }: { type: string, data: any, options: any, height?: string, plugins?: any[] }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      chartRef.current = new Chart(ctx, { type, data, options: { responsive: true, maintainAspectRatio: false, ...options }, plugins: plugins || [] });
    }
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [type, data, options, plugins]);
  return <div style={{ height: height || '100%', width: '100%', position: 'relative' }}><canvas ref={canvasRef} /></div>;
});

const TaskRow = React.memo(({
  task,
  canEdit,
  canToggleActive,
  showToggleColumn,
  onEdit,
  onOpenIssueModal,
  onToggleActive,
  onOpenRevisionModal
}: {
  task: Task;
  canEdit: boolean;
  canToggleActive: boolean;
  showToggleColumn: boolean;
  onEdit: (task: Task) => void;
  onOpenIssueModal: () => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onOpenRevisionModal: (task: Task) => void;
}) => {
  const progress = useMemo(() => {
    const currentPlan = getCurrentPlan(task);
    if (task.status === 'completed') return 100;
    const planHours = hhmmToNumber(currentPlan.hours);
    const actualHours = hhmmToNumber(task.actual.hours);
    if (!planHours || planHours === 0) return 0;
    return Math.min(100, Math.round((actualHours / planHours) * 100));
  }, [task]);
  const statusMap: { [key in TaskStatus]: { text: string; className: string } } = { 'completed': { text: '완료', className: 'status-completed' }, 'in-progress': { text: '진행중', className: 'status-progress' }, 'delayed': { text: '지연', className: 'status-delayed' }, 'not-started': { text: '미시작', className: 'status-pending' } };
  const unreviewedIssueCount = task.monthlyIssues.filter(issue => !issue.reviewed).length;
  const revisionCount = task.revisions ? task.revisions.length : 0;
  const currentPlan = getCurrentPlan(task);
  const isActive = task.isActive !== false;
  const registrationLabel = useMemo(() => {
    if (task.registration && String(task.registration).trim()) return task.registration;
    const createdVia = task.createdVia ?? 'unknown';
    // "Task 등록"(수동 입력)으로 생성된 경우: 항상 '추가' (관리자 포함)
    if (createdVia === 'manual') return '추가';
    // 그 외: 관리자 생성은 R.n, 관리자 외는 '추가'
    const createdByRole = task.createdByRole ?? 'admin';
    if (createdByRole !== 'admin') return '추가';
    return `R.${task.revisions?.length ?? 0}`;
  }, [task.registration, task.createdVia, task.createdByRole, task.revisions]);
  return (
    <tr data-task-id={task.id} className={!isActive ? 'inactive-task' : ''}>
      <td className="actions-cell">
        <button
          className="btn-action edit"
          onClick={() => canEdit && onEdit(task)}
          title={canEdit ? '수정' : '수정 권한 없음'}
          disabled={!canEdit}
          style={{ cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.35 }}
        >
          ✏️
        </button>
      </td>
      <td className="revision-cell" style={{ textAlign: 'center' }}>
        <button 
          className="issue-icon" 
          onClick={() => onOpenIssueModal()}
          title="이슈 관리"
        >
          💬
          {unreviewedIssueCount > 0 && (
            <span className="unreviewed-issue-count">{unreviewedIssueCount}</span>
          )}
        </button>
      </td>
      <td><div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.category1}>{task.category1}</div></td>
      <td><div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.category2}>{task.category2}</div></td>
      <td><div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.category3}>{task.category3}</div></td>
      <td><div style={{ wordBreak: 'break-all' }}>{task.name}</div></td>
      <td><div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={task.assigneeName}>{task.assigneeName}</div></td>
      <td>
        <div style={{ fontSize: '0.85em', lineHeight: '1.4' }}>
          <div style={{ whiteSpace: 'nowrap' }}>{currentPlan.startDate || '-'} ~</div>
          <div style={{ whiteSpace: 'nowrap', marginTop: '2px' }}>{currentPlan.endDate || '-'}</div>
          <div style={{ fontSize: '0.8em', color: '#6c757d', marginTop: '2px' }}>{currentPlan.hours}</div>
        </div>
      </td>
      <td>
        <div style={{ fontSize: '0.85em', lineHeight: '1.4' }}>
          <div style={{ whiteSpace: 'nowrap' }}>{task.actual.startDate || '-'} ~</div>
          <div style={{ whiteSpace: 'nowrap', marginTop: '2px' }}>{task.actual.endDate || '-'}</div>
          <div style={{ fontSize: '0.8em', color: '#6c757d', marginTop: '2px' }}>{task.actual.hours}</div>
        </div>
      </td>
      <td>
        <div
          style={{
            width: '64px',
            height: '14px',
            backgroundColor: '#e9ecef',
            borderRadius: '999px',
            overflow: 'hidden',
            position: 'relative',
            margin: '0 auto'
          }}
          title={`${progress}%`}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(100, progress))}%`,
              height: '100%',
              backgroundColor: progress >= 100 ? '#28a745' : progress >= 70 ? '#20c997' : progress >= 40 ? '#0d6efd' : '#ffc107',
              transition: 'width 0.2s'
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.7em',
              fontWeight: 700,
              color: '#2c3e50'
            }}
          >
            {progress}%
          </div>
        </div>
      </td>
      <td className="status-cell"><span className={`status-badge ${statusMap[task.status].className}`}>{statusMap[task.status].text}</span></td>
      <td style={{ textAlign: 'center' }}>
        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '999px', fontSize: '0.8em', background: '#f1f3f5', color: '#495057', whiteSpace: 'nowrap' }}>
          {registrationLabel}
        </span>
      </td>
      {showToggleColumn && (
        <td className="actions-cell" style={{ textAlign: 'center' }}>
          {canToggleActive ? (
            <button
              className={`btn-action toggle-active ${isActive ? 'active' : ''}`}
              onClick={() => onToggleActive(task.id, isActive)}
              title={isActive ? '비활성화' : '활성화'}
            >
              {isActive ? '👁️' : '👁️‍🗨️'}
            </button>
          ) : (
            <span style={{ opacity: 0.5 }}>-</span>
          )}
        </td>
      )}
      {/* ✅ Task Code 컬럼 분리 */}
      <td style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: '#495057', whiteSpace: 'nowrap' }}>
          {formatTaskCode(task.taskCode)}
        </span>
      </td>
    </tr>
  );
});

// Task Code에서 "업무 코드 조합"(Lv.3 코드) 추출
// 예: DI-AI-NLP-PL01.02.04.01 -> PL01.02.04
const extractLv3CodeFromTaskCode = (taskCode: string): string => {
  const raw = String(taskCode || '').trim();
  if (!raw) return '';
  const tail = raw.split('-').pop() || '';
  const parts = tail.split('.').map(s => s.trim()).filter(Boolean);
  if (parts.length < 3) return '';
  return parts.slice(0, 3).join('.');
};

const calculateMonthlyTrends = (tasks: Task[], year: number) => {
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) { months.push(`${year}-${String(m).padStart(2, '0')}`); }
  const plannedTrend = new Array(months.length).fill(0);
  const actualTrend = new Array(months.length).fill(0);
  tasks.forEach(task => {
    const plan = getCurrentPlan(task);
    if (plan.startDate) { const m = plan.startDate.slice(0, 7); const idx = months.indexOf(m); if (idx >= 0) plannedTrend[idx] += hhmmToNumber(plan.hours); }
    if (task.actual.startDate) { const m = task.actual.startDate.slice(0, 7); const idx = months.indexOf(m); if (idx >= 0) actualTrend[idx] += hhmmToNumber(task.actual.hours); }
  });
  for (let i = 1; i < months.length; i++) { plannedTrend[i] += plannedTrend[i - 1]; actualTrend[i] += actualTrend[i - 1]; }
  return { labels: months, planned: plannedTrend, actual: actualTrend };
};


//2601080127
//0
// -----------------------------------------------------------------------------
// [추가] Lv.2 기준 상태 집계 헬퍼 함수
// 컴포넌트 외부(파일 상단 Utils 영역 근처)에 정의하세요.
// -----------------------------------------------------------------------------
const calculateLv1Stats = (tasks: Task[]) => {
  // 1. Lv.1 별로 Task 그룹화 (Key: Category1)
  const groups: Record<string, Task[]> = {};
  
  tasks.forEach(task => {
    // 카테고리가 없는 경우 'Uncategorized'로 처리하거나 제외
    const key = `${task.category1 || 'Uncategorized'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });

  const counts = { 'completed': 0, 'in-progress': 0, 'delayed': 0, 'not-started': 0 };
  let totalLv1 = 0;

  // 2. 각 Lv.1 그룹의 대표 상태 결정
  Object.values(groups).forEach(groupTasks => {
    if (groupTasks.length === 0) return;
    totalLv1++;

    const total = groupTasks.length;
    const completedCount = groupTasks.filter(t => t.status === 'completed').length;
    const delayedCount = groupTasks.filter(t => t.status === 'delayed').length;
    const inProgressCount = groupTasks.filter(t => t.status === 'in-progress').length;
    
    // [로직] Lv.3가 모두 완료되어야 Lv.1이 완료
    if (completedCount === total) counts['completed']++;
    else if (delayedCount > 0) counts['delayed']++;
    else if (inProgressCount > 0) counts['in-progress']++;
    else counts['not-started']++;
  });

  return { counts, totalLv1 };
};

const calculateLv2Stats = (tasks: Task[]) => {
  // 1. Lv.2 별로 Task 그룹화 (Key: Category1 > Category2)
  const groups: Record<string, Task[]> = {};
  
  tasks.forEach(task => {
    // 카테고리가 없는 경우 'Uncategorized'로 처리하거나 제외
    const key = `${task.category1}||${task.category2}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });

  const counts = { 'completed': 0, 'in-progress': 0, 'delayed': 0, 'not-started': 0 };
  let totalLv2 = 0;

  // 2. 각 Lv.2 그룹의 대표 상태 결정
  Object.values(groups).forEach(groupTasks => {
    if (groupTasks.length === 0) return;
    totalLv2++;

    const total = groupTasks.length;
    const completedCount = groupTasks.filter(t => t.status === 'completed').length;
    const delayedCount = groupTasks.filter(t => t.status === 'delayed').length;
    const inProgressCount = groupTasks.filter(t => t.status === 'in-progress').length;
    
    // [로직] Lv.3가 모두 완료되어야 Lv.2가 완료
    if (completedCount === total) {
      counts['completed']++;
    } 
    // 하위 중 하나라도 지연이면 지연으로 표시 (Risk 강조)
    else if (delayedCount > 0) {
      counts['delayed']++;
    } 
    // 하위 중 하나라도 진행중이면 진행으로 표시
    else if (inProgressCount > 0) {
      counts['in-progress']++;
    } 
    // 나머지는 모두 미시작
    else {
      counts['not-started']++;
    }
  });

  return { counts, totalLv2 };
};

// -----------------------------------------------------------------------------
// [추가] 업무구분 2(category2) 기준 상태 집계 헬퍼 함수
// - Key: Category2
// -----------------------------------------------------------------------------
const calculateCategory2Stats = (tasks: Task[]) => {
  // 1. Category2 별로 Task 그룹화
  const groups: Record<string, Task[]> = {};
  tasks.forEach(task => {
    const key = task.category2 || 'Uncategorized';
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });

  const counts = { 'completed': 0, 'in-progress': 0, 'delayed': 0, 'not-started': 0 };
  let totalCategory2 = 0;

  // 2. 각 Category2 그룹의 대표 상태 결정
  Object.values(groups).forEach(groupTasks => {
    if (groupTasks.length === 0) return;
    totalCategory2++;
    const total = groupTasks.length;
    const completedCount = groupTasks.filter(t => t.status === 'completed').length;
    const delayedCount = groupTasks.filter(t => t.status === 'delayed').length;
    const inProgressCount = groupTasks.filter(t => t.status === 'in-progress').length;
    
    // [로직] 모든 Task가 완료되어야 Category2가 완료
    if (completedCount === total) counts['completed']++;
    else if (delayedCount > 0) counts['delayed']++;
    else if (inProgressCount > 0) counts['in-progress']++;
    else counts['not-started']++;
  });

  return { counts, totalCategory2 };
};

// -----------------------------------------------------------------------------
// [추가] Task Code 기준 상태 집계 헬퍼 함수
// - 각 Task를 개별적으로 집계 (Task Code = Task 단위)
// - 비활성화된 Task는 집계에서 제외
// -----------------------------------------------------------------------------
const calculateTaskCodeStats = (tasks: Task[]) => {
  // 비활성화된 Task 제외
  const activeTasks = tasks.filter(task => task.isActive !== false);
  
  const counts = { 'completed': 0, 'in-progress': 0, 'delayed': 0, 'not-started': 0 };
  const totalTaskCode = activeTasks.length;

  // 각 Task의 상태를 직접 카운트
  activeTasks.forEach(task => {
    if (task.status === 'completed') counts['completed']++;
    else if (task.status === 'delayed') counts['delayed']++;
    else if (task.status === 'in-progress') counts['in-progress']++;
    else counts['not-started']++;
  });

  return { counts, totalTaskCode };
};

// -----------------------------------------------------------------------------
// [추가] Lv.3(Task 1) 기준 상태 집계 헬퍼 함수
// - Key: Category1 > Category2 > Category3
// -----------------------------------------------------------------------------
const calculateLv3Stats = (tasks: Task[]) => {
  const groups: Record<string, Task[]> = {};
  tasks.forEach(task => {
    const key = `${task.category1}||${task.category2}||${task.category3}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });

  const counts = { 'completed': 0, 'in-progress': 0, 'delayed': 0, 'not-started': 0 };
  let totalLv3 = 0;

  Object.values(groups).forEach(groupTasks => {
    if (groupTasks.length === 0) return;
    totalLv3++;

    const total = groupTasks.length;
    const completedCount = groupTasks.filter(t => t.status === 'completed').length;
    const delayedCount = groupTasks.filter(t => t.status === 'delayed').length;
    const inProgressCount = groupTasks.filter(t => t.status === 'in-progress').length;

    if (completedCount === total) counts['completed']++;
    else if (delayedCount > 0) counts['delayed']++;
    else if (inProgressCount > 0) counts['in-progress']++;
    else counts['not-started']++;
  });

  return { counts, totalLv3 };
};
//0
//2601080127

//2601080127
//0
// -----------------------------------------------------------------------------
// [수정 1] GroupPerformanceCard (팀 대시보드 내 그룹 카드)
// -----------------------------------------------------------------------------
const GroupPerformanceCard: React.FC<{ group: Group, tasks: Task[], targetYear: number, onGoToGroup?: (groupId: string) => void }> = React.memo(({ group, tasks, targetYear, onGoToGroup }) => {
  // [변경] Task Code 기준 집계 함수 사용
  const { counts: statusCounts, totalTaskCode } = useMemo(() => calculateTaskCodeStats(tasks), [tasks]);
  
  // 차트 데이터 구성 (total 변수를 Task Code 개수로 변경)
  const total = totalTaskCode || 1; // 0나누기 방지
  
  const donutData = { 
    labels: ['Finished', 'On-Going', 'Delayed', 'Not Started'], 
    datasets: [{ 
      data: [statusCounts['completed'], statusCounts['in-progress'], statusCounts['delayed'], statusCounts['not-started']], 
      backgroundColor: ['#d9534f', '#5bc0de', '#f0ad4e', '#e2e3e5'], 
      borderWidth: 0, 
    }] 
  };
  
  // ✅ Trend(막대)도 업무구분 Lv.2 기준 "건수"로 표시
  // - Plan: 계획 시작월 기준 Lv.2(Task) 건수
  // - Actual: 실적 시작월 기준 Lv.2(Task) 건수
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  const monthlyActual = new Array(12).fill(0);
  const monthlyPlan = new Array(12).fill(0);
  const currentYear = targetYear;
  tasks.forEach(task => {
    const plan = getCurrentPlan(task);
    if (plan.startDate) {
      const d = new Date(plan.startDate);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() === currentYear) {
        monthlyPlan[d.getMonth()] += 1;
      }
    }
    if (task.actual.startDate) {
      const d = new Date(task.actual.startDate);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() === currentYear) {
        monthlyActual[d.getMonth()] += 1;
      }
    }
  });
  const barData = { labels: months, datasets: [ { label: 'Plan', data: monthlyPlan, backgroundColor: '#e0e0e0', hoverBackgroundColor: '#d6d6d6', barThickness: 8, categoryPercentage: 0.6, barPercentage: 0.9 }, { label: 'Actual', data: monthlyActual, backgroundColor: '#357abd', barThickness: 8, categoryPercentage: 0.6, barPercentage: 0.9 } ] };
  
  // 카테고리 분포도 Lv.2 기준으로 변경 필요하다면 로직 수정 가능하나, 일반적으로 점유율은 Task 수나 MH 기준이므로 일단 유지하거나 필요 시 수정. 
  // 여기서는 'Lv.1 과제 점유율'이므로 Task 개수 기준 유지 (또는 Lv.2 개수로 변경 가능). 
  // 요청사항은 "Progress Chart"이므로 위 donutData만 수정 적용함.

  // ✅ MBO 분포: 업무구분 Lv.2 기준 - "(Task code) 진행 건수/총건수, 진행률 (%)" 형식
  // 도넛 차트와 동일하게 비활성화된 Task 제외
  const lv2Dist = useMemo(() => {
    // 비활성화된 Task 제외 (도넛 차트와 동일한 기준)
    const activeTasks = tasks.filter(task => task.isActive !== false);
    
    const lv2Groups: Record<string, Task[]> = {};
    activeTasks.forEach(t => {
      const k1 = String(t.category1 || '').trim();
      const k2 = String(t.category2 || '').trim();
      const key = `${k1}||${k2}`;
      if (!lv2Groups[key]) lv2Groups[key] = [];
      lv2Groups[key].push(t);
    });
    
    return Object.entries(lv2Groups)
      .map(([key, groupTasks]) => {
        const [c1, c2] = key.split('||');
        const label = (c1 && c2) ? `${c2}` : (c2 || c1 || '미분류');
        const fullLabel = (c1 && c2) ? `${c1} > ${c2}` : label;
        
        // 진행 건수: 해당 Lv.2에 속한 Task 중 진행중/지연/완료인 Task 개수 (Task Code 기준)
        const inProgress = groupTasks.filter(t => ['in-progress', 'delayed', 'completed'].includes(t.status)).length;
        // 총 건수: 해당 Lv.2에 속한 모든 Task 개수 (Task Code 기준)
        const total = groupTasks.length;
        // 진행률: (진행 건수 / 총 건수) * 100
        const progressRate = total > 0 ? ((inProgress / total) * 100).toFixed(0) : '0';
        
        return {
          key,
          label,
          fullLabel,
          inProgress,
          total,
          displayText: `(Task code) ${inProgress}/${total}건, ${progressRate}%`,
          percentage: (total / activeTasks.length) * 100
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [tasks]);
  const getCategoryColor = (index: number) => ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69', '#f8f9fa'][index % 8];

  return (
    <div className="group-performance-card" style={{ height: '350px' }}>
      <div className="group-card-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name} ({(group as any).code || group.id})</span>
        {onGoToGroup && (
          <button type="button" className="dash-nav-btn" onClick={() => onGoToGroup(group.id)} title="그룹 뷰로 이동">
            ›
          </button>
        )}
      </div>
      <div className="group-card-body">
         <div className="group-stat-section status">
           <div style={{ height: '140px', position: 'relative' }}>
             <ChartCanvas type="doughnut" data={donutData} options={{ cutout: '50%', plugins: { legend: { display: false } } }} />
             <div className="donut-center-text">
                 {/* [변경] 중앙 텍스트를 Task Code 총 개수로 변경 */}
                 <span className="donut-total">{totalTaskCode}</span>
                 <div style={{fontSize: '0.7rem', color: '#888'}}>Task Code</div>
             </div>
           </div>
           <div className="donut-legend">
            <div className="legend-item"><span className="legend-val" style={{ color: '#d9534f' }}>{statusCounts['completed']}</span><span className="legend-label">Finished</span><span className="legend-pct">{((statusCounts['completed'] / total) * 100).toFixed(0)}%</span></div>
            <div className="legend-item"><span className="legend-val" style={{ color: '#5bc0de' }}>{statusCounts['in-progress']}</span><span className="legend-label">On-Going</span><span className="legend-pct">{((statusCounts['in-progress'] / total) * 100).toFixed(0)}%</span></div>
            <div className="legend-item"><span className="legend-val" style={{ color: '#f0ad4e' }}>{statusCounts['delayed']}</span><span className="legend-label">Delayed</span><span className="legend-pct">{((statusCounts['delayed'] / total) * 100).toFixed(0)}%</span></div>
            <div className="legend-item"><span className="legend-val" style={{ color: '#e2e3e5' }}>{statusCounts['not-started']}</span><span className="legend-label">Not Started</span><span className="legend-pct">{((statusCounts['not-started'] / total) * 100).toFixed(0)}%</span></div>
          </div>
         </div>
         <div className="group-stat-section trend">
            {/* ... (Trend 차트 부분 기존 동일) ... */}
           <div className="card-header-row">
              <span className="mbo-section-title" style={{ borderBottom: 'none', marginBottom: 0, fontSize: '1rem' }}>Monthly Trend (Count)</span>
              <div className="chart-legend-text">
                <div className="legend-item"><span className="legend-dot" style={{background: '#e0e0e0'}}></span>Plan</div>
                <div className="legend-item"><span className="legend-dot" style={{background: '#357abd'}}></span>Actual</div>
              </div>
           </div>
           <div style={{ height: '160px' }}>
             <ChartCanvas type="bar" data={barData} options={{ plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { grid: { display: false } }, y: { display: true, beginAtZero: true, ticks: { font: { size: 10 } } } }, maintainAspectRatio: false }} />
           </div>
         </div>
         <div className="group-stat-section mbo">
            {/* ... (MBO 부분 기존 동일) ... */}
            <h4 className="mbo-section-title">업무구분 (진행 건/총 건)</h4>
            <div className="mbo-dist-container" style={{ maxHeight: '167px', overflowY: 'auto' }}>
                {lv2Dist.map((item, idx) => (
                    <div key={item.key} className="mbo-dist-item">
                        <div className="mbo-dist-header">
                          <span className="mbo-dist-name" title={item.fullLabel} style={{ fontSize: '0.85rem' }}>{item.label}</span>
                          <span className="mbo-dist-val" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }} title={item.displayText}>{item.displayText}</span>
                        </div>
                        <div className="mbo-dist-track">
                          <div 
                            className="mbo-dist-fill" 
                            style={{ width: `${item.percentage}%`, backgroundColor: getCategoryColor(idx) }}
                            title={`${item.label}: ${item.displayText}`}
                          ></div>
                        </div>
                    </div>
                ))}
            </div>
         </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.group.id === nextProps.group.id &&
    prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.targetYear === nextProps.targetYear;
});
//0
//2601080127


const TeamDashboard = React.memo(({ team, tasks, targetYear, onGoToGroup }: { team: Team, tasks: Task[], targetYear: number, onGoToGroup?: (groupId: string) => void }) => {
  // ✅ 팀뷰 집계는 Task Code 기준
  const { counts: overallStatus, totalTaskCode } = useMemo(() => calculateTaskCodeStats(tasks), [tasks]);
  const totalTaskCodeCount = totalTaskCode || 1;

  const donutData = { labels: ['Finished', 'On-Going', 'Delayed', 'Not Started'], datasets: [{ data: [overallStatus['completed'], overallStatus['in-progress'], overallStatus['delayed'], overallStatus['not-started']], backgroundColor: ['#d9534f', '#5bc0de', '#f0ad4e', '#e2e3e5'], borderWidth: 0, }] };
  
  // Trend는 MH 기준이므로 기존 로직 유지
  const overallTrend = useMemo(() => calculateMonthlyTrends(tasks, targetYear), [tasks, targetYear]);
  const trendData = { labels: overallTrend.labels.map(l => l.slice(5)), datasets: [{ label: 'Plan', data: overallTrend.planned, borderColor: '#8884d8', backgroundColor: 'rgba(136, 132, 216, 0.2)', fill: true, tension: 0.4 }, { label: 'Actual', data: overallTrend.actual, borderColor: '#82ca9d', backgroundColor: 'rgba(130, 202, 157, 0.2)', fill: true, tension: 0.4 }] };
  
  // 비율 계산 함수
  const getPct = (val: number) => ((val / totalTaskCodeCount) * 100).toFixed(1);

  return (
    <div className="division-dashboard">
      <div className="division-sidebar-panel">
        <div className="division-panel-card">
          <h3 className="panel-title">Progress and Status (Task Code)</h3>
          <div className="overall-donut-container">
              <ChartCanvas type="doughnut" data={donutData} options={{ cutout: '50%', plugins: { legend: { display: false } } }} height="220px" />
              <div className="overall-center-text">
                  <span className="overall-total">{totalTaskCode}</span>
                  <div style={{fontSize: '0.8rem', color: '#888'}}>Task Code</div>
              </div>
          </div>
           <div className="metric-summary-grid">
            <div className="metric-box"><span className="metric-label">Finished</span><span className="metric-val" style={{ color: '#d9534f' }}>{overallStatus['completed']}</span><span className="metric-pct">({getPct(overallStatus['completed'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">On-Going</span><span className="metric-val" style={{ color: '#5bc0de' }}>{overallStatus['in-progress']}</span><span className="metric-pct">({getPct(overallStatus['in-progress'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">Delayed</span><span className="metric-val" style={{ color: '#f0ad4e' }}>{overallStatus['delayed']}</span><span className="metric-pct">({getPct(overallStatus['delayed'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">Not Started</span><span className="metric-val" style={{ color: '#adb5bd' }}>{overallStatus['not-started']}</span><span className="metric-pct">({getPct(overallStatus['not-started'])}%)</span></div>
          </div>
        </div>
        <div className="division-panel-card" style={{ flexGrow: 1 }}>
          <div className="card-header-row">
            <h3 className="panel-title" style={{ borderBottom: 'none', marginBottom: 0 }}>Man-hour Trend</h3>
            <div className="chart-legend-text">
                <div className="legend-item"><span className="legend-dot" style={{background: '#8884d8'}}></span>Plan</div>
                <div className="legend-item"><span className="legend-dot" style={{background: '#82ca9d'}}></span>Actual</div>
            </div>
          </div>
          <div className="trend-chart-container"><ChartCanvas type="line" data={trendData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} height="200px" /></div>
        </div>
      </div>
      <div className="division-main-grid" style={{ gridTemplateColumns: '1fr', gap: '20px' }}>
        {team.groups.map(group => (
          <GroupPerformanceCard
            key={group.id}
            group={group}
            tasks={tasks.filter(t => t.group === group.name)}
            targetYear={targetYear}
            onGoToGroup={onGoToGroup}
          />
        ))}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.team.id === nextProps.team.id &&
    prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.targetYear === nextProps.targetYear;
});

const AssigneeListCard = React.memo(({
  group,
  tasks,
  targetYear,
  onGoToMemberDashboard,
  currentUser
}: {
  group: Group;
  tasks: Task[];
  targetYear: number;
  onGoToMemberDashboard?: (memberId: string) => void;
  currentUser?: UserContextType | null;
}) => {
  const groupStats = useMemo(() => {
    // ✅ 그룹 뷰(우측 담당자 카드) 집계는 Task Code 기준
    const { counts, totalTaskCode } = calculateTaskCodeStats(tasks);
    const total = totalTaskCode || 1;
    return {
      completed: counts['completed'],
      inProgress: counts['in-progress'],
      delayed: counts['delayed'],
      notStarted: counts['not-started'],
      total,
      completionRate: ((counts['completed'] / total) * 100).toFixed(0),
      taskCodeCount: totalTaskCode
    };
  }, [tasks]);

  const getCategoryColor = (index: number) => ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69', '#f8f9fa'][index % 8];

  return (
    <div className="dashboard-card assignee-card-v2" style={{ display: 'flex', flexDirection: 'column', padding: '1.5rem', height: '2355px', overflowY: 'auto' }}>
      <div className="assignee-card-header"><h3 className="group-name-title">{group.name} ({(group as any).code || ''})</h3><span className="total-task-badge">{groupStats.taskCodeCount} Task Code</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minHeight: 0 }}>
        {group.members
          .filter(member => {
            if (!currentUser) return true;
            
            const isDeptHead = member.role === 'dept_head' || (typeof member.position === 'string' && member.position.includes('실장'));
            const isTeamLeader = member.role === 'team_leader' || (typeof member.position === 'string' && member.position.includes('팀장'));
            const isGroupLeader = member.role === 'group_leader' || (typeof member.position === 'string' && member.position.includes('그룹장'));
            
            // 담당자(member) 권한: 실장/팀장/그룹장 카드 모두 숨김
            if (currentUser.role === 'member') {
              return !isDeptHead && !isTeamLeader && !isGroupLeader;
            }
            // 그룹장 권한: 실장/팀장 카드 숨김
            else if (currentUser.role === 'group_leader') {
              return !isDeptHead && !isTeamLeader;
            }
            // 팀장 권한: 실장 카드 숨김
            else if (currentUser.role === 'team_leader') {
              return !isDeptHead;
            }
            
            return true;
          })
          .map(member => {
          const memberTasks = tasks.filter(t => t.assignee === member.id);
          const { counts, totalTaskCode } = calculateTaskCodeStats(memberTasks);
          const total = totalTaskCode || 1;
          const completionRate = total > 0 ? ((counts['completed'] / total) * 100).toFixed(0) : '0';

          // 업무구분별 통계 (mbo 형식)
          const category2Groups: Record<string, Task[]> = {};
          memberTasks.forEach(t => {
            const k2 = String(t.category2 || '').trim();
            if (!category2Groups[k2]) category2Groups[k2] = [];
            category2Groups[k2].push(t);
          });
          
          const category2Dist = Object.entries(category2Groups)
            .map(([key, groupTasks]) => {
              const inProgress = groupTasks.filter(t => ['in-progress', 'delayed', 'completed'].includes(t.status)).length;
              const total = groupTasks.length;
              return {
                key,
                label: key || '미분류',
                inProgress,
                total,
                displayText: `(Task Code) ${inProgress}/${total}건`,
                percentage: memberTasks.length > 0 ? (total / memberTasks.length) * 100 : 0
              };
            })
            .sort((a, b) => b.total - a.total);

          // Monthly Man-hour 차트 데이터
          const monthlyActual = new Array(12).fill(0);
          const monthlyPlan = new Array(12).fill(0);
          const currentYear = targetYear;
          memberTasks.forEach(task => {
            if (task.actual.hours && task.actual.startDate) {
              const dist = distributeHoursByMonth(task.actual.startDate, task.actual.endDate, task.actual.hours, currentYear);
              dist.forEach((h, i) => monthlyActual[i] += h);
            }
            const plan = getCurrentPlan(task);
            if (plan.hours && plan.startDate) {
              const dist = distributeHoursByMonth(plan.startDate, plan.endDate, plan.hours, currentYear);
              dist.forEach((h, i) => monthlyPlan[i] += h);
            }
          });
          const barChartData = {
            labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
            datasets: [
              { label: 'Plan', data: monthlyPlan, backgroundColor: '#e0e0e0', hoverBackgroundColor: '#d6d6d6', barThickness: 12, categoryPercentage: 0.6, barPercentage: 0.9 },
              { label: 'Actual', data: monthlyActual, backgroundColor: '#357abd', barThickness: 12, categoryPercentage: 0.6, barPercentage: 0.9 }
            ]
          };

          const donutData = {
            labels: ['Finished', 'On-Going', 'Delayed', 'Not Started'],
            datasets: [{
              data: [counts['completed'], counts['in-progress'], counts['delayed'], counts['not-started']],
              backgroundColor: ['#d9534f', '#5bc0de', '#f0ad4e', '#e2e3e5'],
              borderWidth: 0,
            }]
          };

          return (
            <div key={member.id} style={{ border: '1px solid #e9ecef', borderRadius: '8px', padding: '15px', backgroundColor: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '0.95rem' }}>
                  {member.name} <small style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'normal' }}>({member.position})</small>
                  <button
                    type="button"
                    className="dash-nav-btn"
                    title="담당자 대시보드 보기"
                    onClick={() => onGoToMemberDashboard && onGoToMemberDashboard(member.id)}
                  >
                    ›
                  </button>
                </span>
                <span style={{ fontSize: '0.85rem', color: '#6c757d', background: 'white', padding: '1px 6px', borderRadius: '10px', border: '1px solid #dee2e6' }}>{totalTaskCode} Task Code</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                {/* Status 섹션 (도넛 차트) */}
                <div className="group-stat-section status" style={{ flex: '0 0 300px', alignItems: 'center' }}>
                  <div style={{ height: '140px', position: 'relative' }}>
                    <ChartCanvas type="doughnut" data={donutData} options={{ cutout: '50%', plugins: { legend: { display: false } } }} />
                    <div className="donut-center-text">
                      <span className="donut-total">{totalTaskCode}</span>
                      <div style={{fontSize: '0.7rem', color: '#888'}}>Task Code</div>
                    </div>
                  </div>
                  <div className="donut-legend">
                    <div className="legend-item"><span className="legend-val" style={{ color: '#d9534f' }}>{counts['completed']}</span><span className="legend-label">Finished</span><span className="legend-pct">{((counts['completed'] / total) * 100).toFixed(0)}%</span></div>
                    <div className="legend-item"><span className="legend-val" style={{ color: '#5bc0de' }}>{counts['in-progress']}</span><span className="legend-label">On-Going</span><span className="legend-pct">{((counts['in-progress'] / total) * 100).toFixed(0)}%</span></div>
                    <div className="legend-item"><span className="legend-val" style={{ color: '#f0ad4e' }}>{counts['delayed']}</span><span className="legend-label">Delayed</span><span className="legend-pct">{((counts['delayed'] / total) * 100).toFixed(0)}%</span></div>
                    <div className="legend-item"><span className="legend-val" style={{ color: '#e2e3e5' }}>{counts['not-started']}</span><span className="legend-label">Not Started</span><span className="legend-pct">{((counts['not-started'] / total) * 100).toFixed(0)}%</span></div>
                  </div>
                </div>
                
                {/* 업무구분별 통계 */}
                <div>
                  <h4 className="mbo-section-title" style={{ fontSize: '0.85rem', marginBottom: '8px' }}>업무구분 (진행 건/총 건)</h4>
                  <div className="mbo-dist-container" style={{ maxHeight: '162px', overflowY: 'auto' }}>
                    {category2Dist.map((item, idx) => (
                      <div key={item.key} className="mbo-dist-item">
                        <div className="mbo-dist-header">
                          <span className="mbo-dist-name" style={{ fontSize: '0.8rem' }}>{item.label}</span>
                          <span className="mbo-dist-val" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{item.displayText}</span>
                        </div>
                        <div className="mbo-dist-track">
                          <div
                            className="mbo-dist-fill"
                            style={{ width: `${item.percentage}%`, backgroundColor: getCategoryColor(idx) }}
                            title={`${item.label}: ${item.inProgress}/${item.total}건`}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Monthly Man-hour 차트 */}
                <div>
                  <div className="card-header-row" style={{ marginBottom: '8px' }}>
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 'bold', margin: 0 }}>Monthly Man-hour - {targetYear}</h4>
                    <div className="chart-legend-text" style={{ fontSize: '0.7rem' }}>
                      <div className="legend-item"><span className="legend-dot" style={{background: '#e0e0e0'}}></span>Plan</div>
                      <div className="legend-item"><span className="legend-dot" style={{background: '#357abd'}}></span>Actual</div>
                    </div>
                  </div>
                  <div style={{ height: '120px' }}>
                    <ChartCanvas type="bar" data={barChartData} options={{ plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, scales: { y: { display: true, beginAtZero: true, ticks: { font: { size: 9 } } }, x: { grid: { display: false }, ticks: { font: { size: 9 } } } }, maintainAspectRatio: false }} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.group.id === nextProps.group.id &&
    prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.targetYear === nextProps.targetYear &&
    prevProps.currentUser?.id === nextProps.currentUser?.id;
});
//2601080127
//0
// -----------------------------------------------------------------------------
// [수정 2] GroupDashboard (그룹 상세 뷰)
// -----------------------------------------------------------------------------
const GroupDashboard: React.FC<{
  group: Group;
  tasks: Task[];
  targetYear: number;
  currentUser: UserContextType;
  onDrillDown: (tasks: Task[]) => void;
  onNavigateToIssue: (task: Task) => void;
  onGoToMemberDashboard?: (memberId: string) => void;
}> = React.memo(({ group, tasks, targetYear, currentUser, onDrillDown, onNavigateToIssue, onGoToMemberDashboard }) => {
  // ✅ 초록 박스(상단 그룹 대시보드)는 "담당자(member)"만 제외하고 볼 수 있음 (관리자/실장/팀장/그룹장 포함)
  // ✅ 빨간 박스(하단 카드 대시보드)는 "해당 그룹의 그룹장"만 볼 수 있음
  const canViewAttentionCards =
    currentUser?.role === 'admin' ||
    currentUser?.role === 'dept_head' ||
    currentUser?.role === 'team_leader' ||
    (currentUser?.role === 'group_leader' && !!currentUser.groupId && currentUser.groupId === group.id);

  // ✅ 모든 권한자가 Progress/Trend/Monthly 대시보드를 볼 수 있도록 허용

  // ✅ 그룹 뷰 상단 대시보드 집계는 Task Code 기준
  const { counts: statusCounts, totalTaskCode } = useMemo(() => calculateTaskCodeStats(tasks), [tasks]);
  const totalTaskCodeCount = totalTaskCode || 1;

  const donutData = { labels: ['Finished', 'On-Going', 'Delayed', 'Not Started'], datasets: [{ data: [statusCounts['completed'], statusCounts['in-progress'], statusCounts['delayed'], statusCounts['not-started']], backgroundColor: ['#d9534f', '#5bc0de', '#f0ad4e', '#e2e3e5'], borderWidth: 0 }] };
  
  // Trend 및 Bar 차트는 Task 시수(MH) 기준이므로 기존 로직 유지
  const overallTrend = useMemo(() => calculateMonthlyTrends(tasks, targetYear), [tasks, targetYear]);
  const lineChartData = { labels: overallTrend.labels.map(l => l.slice(5)), datasets: [{ label: 'Plan', data: overallTrend.planned, borderColor: '#adb5bd', backgroundColor: 'rgba(173, 181, 189, 0.2)', fill: true, tension: 0.4, pointRadius: 0 }, { label: 'Actual', data: overallTrend.actual, borderColor: '#2c3e50', backgroundColor: 'transparent', fill: false, tension: 0.4, pointBackgroundColor: '#2c3e50', pointRadius: 3 }] };
  const monthlyActual = new Array(12).fill(0);
  const monthlyPlan = new Array(12).fill(0);
  const currentYear = targetYear;
  tasks.forEach(task => {
    if (task.actual.hours && task.actual.startDate) { const dist = distributeHoursByMonth(task.actual.startDate, task.actual.endDate, task.actual.hours, currentYear); dist.forEach((h, i) => monthlyActual[i] += h); }
    const plan = getCurrentPlan(task);
    if (plan.hours && plan.startDate) { const dist = distributeHoursByMonth(plan.startDate, plan.endDate, plan.hours, currentYear); dist.forEach((h, i) => monthlyPlan[i] += h); }
  });
  const barChartData = { labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`), datasets: [ { label: 'Plan', data: monthlyPlan, backgroundColor: '#e0e0e0', hoverBackgroundColor: '#d6d6d6', barThickness: 12, categoryPercentage: 0.6, barPercentage: 0.9 }, { label: 'Actual', data: monthlyActual, backgroundColor: '#357abd', barThickness: 12, categoryPercentage: 0.6, barPercentage: 0.9 } ] };

  const today = new Date().toISOString().split('T')[0];
  const delayedStartTasks = tasks.filter(task => { const planStart = getCurrentPlan(task).startDate; return task.status === 'not-started' && planStart && planStart < today; });
  const overdueCompletionTasks = tasks.filter(task => { const planEnd = getCurrentPlan(task).endDate; return ['in-progress', 'delayed'].includes(task.status) && planEnd && planEnd < today; });
  const tasksDueSoon = tasks.filter(task => { const planEnd = getCurrentPlan(task).endDate; if (!['in-progress', 'delayed'].includes(task.status) || !planEnd) return false; const diffDays = dateDiffInDays(planEnd, today); return diffDays >= 0 && diffDays <= 7; });
  const tasksWithUnreviewedIssues = tasks.filter(task => task.monthlyIssues.some(issue => !issue.reviewed));
  const tasksWithReviewOpinions = tasks.filter(task =>
    task.monthlyIssues.some(issue =>
      issue.replies && issue.replies.some(reply => !reply.checked)
    )
  );

  const renderDelayBadge = (days: number) => {
    let bgColor, textColor;
    if (days <= 7) { bgColor = '#d3f9d8'; textColor = '#2b8a3e'; }
    else if (days <= 14) { bgColor = '#ffe8cc'; textColor = '#e8590c'; }
    else { bgColor = '#ffe3e3'; textColor = '#c92a2a'; }
    return (
      <span style={{ backgroundColor: bgColor, color: textColor, padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600', marginLeft: '8px', flexShrink: 0, display: 'inline-block', lineHeight: '1.4' }}>
        +{days}일
      </span>
    );
  };

  // 비율 계산 함수
  const getPct = (val: number) => ((val / totalTaskCodeCount) * 100).toFixed(1);

  return (
    <div>
      <div className="division-dashboard" style={{ height: '941px' }}>
        <div className="division-sidebar-panel" style={{ height: '1016px' }}>
          <div className="division-panel-card">
            <h3 className="panel-title">Progress and Status (Task Code)</h3>
            <div className="overall-donut-container">
                <ChartCanvas type="doughnut" data={donutData} options={{ cutout: '50%', plugins: { legend: { display: false } } }} height="220px" />
                <div className="overall-center-text">
                    <span className="overall-total">{totalTaskCode}</span>
                    <div style={{fontSize: '0.8rem', color: '#888'}}>Task Code</div>
                </div>
            </div>
             <div className="metric-summary-grid">
              <div className="metric-box"><span className="metric-label">Finished</span><span className="metric-val" style={{ color: '#d9534f' }}>{statusCounts['completed']}</span><span className="metric-pct">({getPct(statusCounts['completed'])}%)</span></div>
              <div className="metric-box"><span className="metric-label">On-Going</span><span className="metric-val" style={{ color: '#5bc0de' }}>{statusCounts['in-progress']}</span><span className="metric-pct">({getPct(statusCounts['in-progress'])}%)</span></div>
              <div className="metric-box"><span className="metric-label">Delayed</span><span className="metric-val" style={{ color: '#f0ad4e' }}>{statusCounts['delayed']}</span><span className="metric-pct">({getPct(statusCounts['delayed'])}%)</span></div>
              <div className="metric-box"><span className="metric-label">Not Started</span><span className="metric-val" style={{ color: '#adb5bd' }}>{statusCounts['not-started']}</span><span className="metric-pct">({getPct(statusCounts['not-started'])}%)</span></div>
            </div>
          </div>
          <div className="division-panel-card" style={{ height: '334px' }}>
            <div className="card-header-row">
              <h3 className="panel-title" style={{ borderBottom: 'none', marginBottom: 0 }}>Man-hour Trend</h3>
              <div className="chart-legend-text">
                  <div className="legend-item"><span className="legend-dot" style={{background: '#adb5bd'}}></span>Plan</div>
                  <div className="legend-item"><span className="legend-dot" style={{background: '#2c3e50'}}></span>Actual</div>
              </div>
            </div>
            <div className="trend-chart-container"><ChartCanvas type="line" data={lineChartData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} height="200px" /></div>
          </div>
        </div>
        <div className="division-main-grid" style={{ display: 'flex', flexDirection: 'column', gap: '0px', height: '1326px' }}>
          {/* 그룹 뷰 하단 카드 대시보드 (그룹장만) */}
          {canViewAttentionCards && (
            <div className="attention-grid" style={{ marginBottom: '20px', width: '985px' }}>
              <div className="attention-card" onClick={() => onDrillDown(delayedStartTasks)}><div className="att-header"><span className="att-icon">⏰</span> <span className="att-title">시작 지연 Task</span> <span className="att-count">{delayedStartTasks.length}</span></div><div className="att-content">{delayedStartTasks.length === 0 ? <p className="att-empty">해당 Task가 없습니다.</p> : <ul className="att-list">{delayedStartTasks.map(t => { const planStart = getCurrentPlan(t).startDate; const delayDays = planStart ? dateDiffInDays(today, planStart) : 0; return <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }} title={t.name}>{t.name}</span>{renderDelayBadge(delayDays)}</li>; })}</ul>}</div></div>
              <div className="attention-card" onClick={() => onDrillDown(overdueCompletionTasks)}><div className="att-header"><span className="att-icon">🔥</span> <span className="att-title">종료 지연 Task</span> <span className="att-count">{overdueCompletionTasks.length}</span></div><div className="att-content">{overdueCompletionTasks.length === 0 ? <p className="att-empty">해당 Task가 없습니다.</p> : <ul className="att-list">{overdueCompletionTasks.map(t => { const planEnd = getCurrentPlan(t).endDate; const delayDays = planEnd ? dateDiffInDays(today, planEnd) : 0; return <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }} title={t.name}>{t.name}</span>{renderDelayBadge(delayDays)}</li>; })}</ul>}</div></div>
              <div className="attention-card" onClick={() => onDrillDown(tasksDueSoon)}><div className="att-header"><span className="att-icon">⏳</span> <span className="att-title">마감 임박 Task (7일 이내)</span> <span className="att-count">{tasksDueSoon.length}</span></div><div className="att-content">{tasksDueSoon.length === 0 ? <p className="att-empty">해당 Task가 없습니다.</p> : <ul className="att-list">{tasksDueSoon.map(t => <li key={t.id}>{t.name}</li>)}</ul>}</div></div>

              <div className="attention-card" onClick={() => onDrillDown(tasksWithReviewOpinions)}>
                <div className="att-header">
                  <span className="att-icon">💬</span>
                  <span className="att-title">검토 의견 알림</span>
                  <span className="att-count">{tasksWithReviewOpinions.length}</span>
                </div>
                <div className="att-content">
                  {tasksWithReviewOpinions.length === 0 ? (
                    <p className="att-empty">확인할 새 의견이 없습니다.</p>
                  ) : (
                    <ul className="att-list issues">
                      {tasksWithReviewOpinions.map(t => {
                        let unreadCount = 0;
                        let latestReplyText = "";
                        t.monthlyIssues.forEach(issue => {
                          if (issue.replies) {
                            issue.replies.forEach(r => {
                              if (!r.checked) {
                                unreadCount++;
                                latestReplyText = typeof r === 'object' ? r.text : r;
                              }
                            });
                          }
                        });
                        return (
                          <li
                            key={t.id}
                            onClick={(e) => { e.stopPropagation(); onNavigateToIssue(t); }}
                            style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div className="att-issue-row">
                              <div style={{ maxWidth: '75%', overflow: 'hidden' }}>
                                <div className="att-issue-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#007bff', fontWeight: 'bold' }}>{t.name}</div>
                                {latestReplyText && (
                                  <div style={{ fontSize: '0.8rem', color: '#868e96', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    ↳ {latestReplyText}
                                  </div>
                                )}
                                <div className="att-issue-assignee">미확인 댓글 {unreadCount}건</div>
                              </div>
                              <span className="att-issue-badge" style={{ backgroundColor: '#e7f5ff', color: '#004085' }}>New</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="attention-card" onClick={() => onDrillDown(tasksWithUnreviewedIssues)}>
                <div className="att-header">
                  <span className="att-icon">📝</span>
                  <span className="att-title">미검토 이슈 Task</span>
                  <span className="att-count">{tasksWithUnreviewedIssues.length}</span>
                </div>
                <div className="att-content">
                  {tasksWithUnreviewedIssues.length === 0 ? (
                    <p className="att-empty">해당 Task가 없습니다.</p>
                  ) : (
                    <ul className="att-list issues">
                      {tasksWithUnreviewedIssues.map(t => {
                        const unreviewedItems = t.monthlyIssues.filter(i => !i.reviewed);
                        const latestIssue = unreviewedItems.length > 0 ? unreviewedItems[unreviewedItems.length - 1] : null;
                        return (
                          <li
                            key={t.id}
                            onClick={(e) => { e.stopPropagation(); onNavigateToIssue(t); }}
                            style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8f9fa'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div className="att-issue-row">
                              <div style={{ maxWidth: '85%', overflow: 'hidden' }}>
                                <div className="att-issue-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#007bff', fontWeight: 'bold' }}>{t.name}</div>
                                {latestIssue && (
                                  <div style={{ fontSize: '0.8rem', color: '#868e96', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    - {latestIssue.issue}
                                  </div>
                                )}
                                <div className="att-issue-assignee">{t.assigneeName}</div>
                              </div>
                              <span className="att-issue-badge">{unreviewedItems.length}개</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
          
          <AssigneeListCard 
            group={group} 
            tasks={tasks} 
            targetYear={targetYear} 
            onGoToMemberDashboard={onGoToMemberDashboard}
            currentUser={currentUser}
          />
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.group.id === nextProps.group.id &&
    prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.targetYear === nextProps.targetYear &&
    prevProps.currentUser?.id === nextProps.currentUser?.id;
});
//0
//2601080127



const TeamCard: React.FC<{ team: Team, tasks: Task[], targetYear: number, onGoToTeam?: (teamId: string) => void }> = React.memo(({ team, tasks, targetYear, onGoToTeam }) => {
  // ✅ 실 대시보드(팀 카드) 집계는 Task Code 기준
  const { counts: statusCounts, totalTaskCode } = useMemo(() => calculateTaskCodeStats(tasks), [tasks]);
  const total = totalTaskCode || 0;
  const completionRate = total > 0 ? ((statusCounts['completed'] / total) * 100).toFixed(0) : '0';
  const [tooltipData, setTooltipData] = useState<{ label: string, count: number, pct: string, color: string } | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const handleMouseEnter = (label: string, count: number, color: string) => { setTooltipData({ label, count, pct: (total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'), color }); setShowTooltip(true); };
  const handleMouseLeave = () => { setShowTooltip(false); setTooltipData(null); };

  // 업무 구분별 통계 계산 (category1 기준)
  const categoryStats = useMemo(() => {
    const categoryGroups: Record<string, Task[]> = {};
    tasks.forEach(task => {
      const cat1 = task.category1 || '기타';
      if (!categoryGroups[cat1]) categoryGroups[cat1] = [];
      categoryGroups[cat1].push(task);
    });

    // 각 category1별로 Task Code 개수 계산
    const stats: Array<{ category1: string; count: number; percentage: number }> = [];
    Object.keys(categoryGroups).forEach(cat1 => {
      const catTasks = categoryGroups[cat1];
      const { totalTaskCode: catTaskCode } = calculateTaskCodeStats(catTasks);
      stats.push({
        category1: cat1,
        count: catTaskCode || 0,
        percentage: total > 0 ? ((catTaskCode || 0) / total) * 100 : 0
      });
    });

    return stats.sort((a, b) => b.count - a.count);
  }, [tasks, total]);

  // 업무 구분별 색상 매핑 (getCategoryColor와 동일한 색상 팔레트)
  const getCategoryColor = (index: number) => ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#5a5c69', '#f8f9fa'][index % 8];
  const trend = useMemo(() => calculateMonthlyTrends(tasks, targetYear), [tasks, targetYear]);
  const chartData = useMemo(() => ({
    labels: trend.labels.map(l => l.slice(5)),
    datasets: [{ label: 'Plan', data: trend.planned, borderColor: '#8884d8', backgroundColor: 'rgba(136, 132, 216, 0.2)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.4, fill: true }, { label: 'Actual', data: trend.actual, borderColor: '#82ca9d', backgroundColor: 'rgba(130, 202, 157, 0.2)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#82ca9d', pointHoverRadius: 5, tension: 0.4, fill: true }]
  }), [trend]);
  const chartOptions = useMemo(() => ({ plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index' as const, intersect: false } }, scales: { x: { display: true, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0 } }, y: { display: true, beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: { font: { size: 10 } } } }, maintainAspectRatio: false, layout: { padding: { top: 0, bottom: 0, left: 0, right: 10 } } }), []);

  return (
      <div className="dashboard-card team-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', height: '378px', gap: '15px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '1.2em', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.name} ({(team as any).code || ''})</h3>
              {onGoToTeam && (
                <button type="button" className="dash-nav-btn" onClick={() => onGoToTeam(team.id)} title="팀 뷰로 이동">
                  ›
                </button>
              )}
            </div>
            <span style={{ fontSize: '0.9em', color: '#6c757d', flexShrink: 0 }}>{total} Task Code</span>
          </div>
          <div style={{ flexShrink: 0, position: 'relative' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', marginBottom: '6px', color: '#333' }}><span style={{ fontWeight: 500 }}>Completion</span><span style={{ fontWeight: 700 }}>{completionRate}%</span></div>
             <div className="mbo-dist-track" style={{ height: '6px', background: '#f0f0f0', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
              {categoryStats.map((stat, idx) => (
                <div
                  key={stat.category1}
                  className="mbo-dist-fill"
                  style={{
                    width: `${stat.percentage}%`,
                    backgroundColor: getCategoryColor(idx),
                    height: '100%',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={() => handleMouseEnter(stat.category1, stat.count, getCategoryColor(idx))}
                  onMouseLeave={handleMouseLeave}
                  title={`${stat.category1}: ${stat.count}건 (${stat.percentage.toFixed(1)}%)`}
                ></div>
              ))}
            </div>
            {showTooltip && tooltipData && (<div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '8px', backgroundColor: 'rgba(40, 44, 52, 0.95)', color: 'white', padding: '8px 12px', borderRadius: '4px', fontSize: '0.85rem', whiteSpace: 'nowrap', zIndex: 10, boxShadow: '0 2px 5px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '8px' }}> <span style={{ display: 'inline-block', width: '10px', height: '10px', backgroundColor: tooltipData.color, borderRadius: '2px' }}></span> <span>{tooltipData.label}: <strong>{tooltipData.count}건</strong> ({tooltipData.pct}%)</span> <div style={{ position: 'absolute', top: '100%', left: '50%', marginLeft: '-5px', borderWidth: '5px', borderStyle: 'solid', borderColor: 'rgba(40, 44, 52, 0.95) transparent transparent transparent' }}></div> </div>)}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="card-header-row" style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '0.9rem', color: '#adb5bd', fontWeight: 'bold' }}>Cumulative Trend ({targetYear})</div>
                <div className="chart-legend-text" style={{ fontSize: '0.75rem' }}>
                    <div className="legend-item"><span className="legend-dot" style={{background: '#8884d8'}}></span>Plan</div>
                    <div className="legend-item"><span className="legend-dot" style={{background: '#82ca9d'}}></span>Actual</div>
                </div>
            </div>
            <div style={{ flex: 1, width: '100%', position: 'relative' }}><ChartCanvas type="line" data={chartData} options={chartOptions} /></div>
          </div>
          <div className="team-groups-list" style={{ borderTop: '1px solid #eee', paddingTop: '12px', marginTop: 'auto', flexShrink: 0 }}>
            {team.groups.map(g => {
              const groupTasks = tasks.filter(t => t.group === g.name);
              const { totalTaskCode: gTaskCode } = calculateTaskCodeStats(groupTasks);
              const groupCode = (g as any).code || g.id;
              return (
                <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9em', color: '#555', padding: '3px 0' }}>
                  <span>{g.name} ({groupCode})</span>
                  <span style={{ fontWeight: 600 }}>{gTaskCode}</span>
                </div>
              );
            })}
          </div>
      </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.team.id === nextProps.team.id &&
    prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.targetYear === nextProps.targetYear;
});
//2601080127
//0
// -----------------------------------------------------------------------------
// [수정 3] DivisionDashboard (실/부문 대시보드)
// -----------------------------------------------------------------------------
const DivisionDashboard = React.memo(({ data, tasks, targetYear, onGoToTeam }: { data: SampleData, tasks: Task[], targetYear: number, onGoToTeam?: (teamId: string) => void }) => {
  // ✅ 실(Department) 대시보드 집계는 "모든 팀원(Task)" 기준
  // - 호출부에서 이미 실 범위/기간 필터를 적용해 전달
  // - 여기서는 추가 필터(활성/비활성)를 강제하지 않음
  const allTasks = useMemo(() => tasks, [tasks]);
  const teams = data.organization.departments[0].teams;

  // [변경] Task Code 기준 집계 함수 사용
  const { counts: overallStatus, totalTaskCode } = useMemo(() => calculateTaskCodeStats(allTasks), [allTasks]);
  const totalTaskCodeCount = totalTaskCode || 1;

  const donutData = { labels: ['Finished', 'On-Going', 'Delayed', 'Not Started'], datasets: [{ data: [overallStatus['completed'], overallStatus['in-progress'], overallStatus['delayed'], overallStatus['not-started']], backgroundColor: ['#d9534f', '#5bc0de', '#f0ad4e', '#e2e3e5'], borderWidth: 0, }] };
  
  // Trend는 MH 기준이므로 기존 로직 유지
  const overallTrend = useMemo(() => calculateMonthlyTrends(allTasks, targetYear), [allTasks, targetYear]);
  const trendData = { labels: overallTrend.labels.map(l => l.slice(5)), datasets: [{ label: 'Plan', data: overallTrend.planned, borderColor: '#8884d8', backgroundColor: 'rgba(136, 132, 216, 0.2)', fill: true, tension: 0.4 }, { label: 'Actual', data: overallTrend.actual, borderColor: '#82ca9d', backgroundColor: 'rgba(130, 202, 157, 0.2)', fill: true, tension: 0.4 }] };
  
  // 비율 계산 함수
  const getPct = (val: number) => ((val / totalTaskCodeCount) * 100).toFixed(1);

  return (
    <div className="division-dashboard">
      <div className="division-sidebar-panel">
        <div className="division-panel-card">
          <h3 className="panel-title">Progress and Status (Task Code)</h3>
          <div className="overall-donut-container">
              <ChartCanvas type="doughnut" data={donutData} options={{ cutout: '50%', plugins: { legend: { display: false } } }} height="220px" />
              <div className="overall-center-text">
                  {/* [변경] 중앙 텍스트를 Task Code 총 개수로 변경 */}
                  <span className="overall-total">{totalTaskCode}</span>
                  <div style={{fontSize: '0.8rem', color: '#888'}}>Task Code</div>
              </div>
          </div>
           <div className="metric-summary-grid">
            <div className="metric-box"><span className="metric-label">Finished</span><span className="metric-val" style={{ color: '#d9534f' }}>{overallStatus['completed']}</span><span className="metric-pct">({getPct(overallStatus['completed'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">On-Going</span><span className="metric-val" style={{ color: '#5bc0de' }}>{overallStatus['in-progress']}</span><span className="metric-pct">({getPct(overallStatus['in-progress'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">Delayed</span><span className="metric-val" style={{ color: '#f0ad4e' }}>{overallStatus['delayed']}</span><span className="metric-pct">({getPct(overallStatus['delayed'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">Not Started</span><span className="metric-val" style={{ color: '#adb5bd' }}>{overallStatus['not-started']}</span><span className="metric-pct">({getPct(overallStatus['not-started'])}%)</span></div>
          </div>
        </div>
        {/* ... (Trend Card 기존 동일) ... */}
        <div className="division-panel-card" style={{ flexGrow: 1 }}>
          <div className="card-header-row">
            <h3 className="panel-title" style={{ borderBottom: 'none', marginBottom: 0 }}>Man-hour Trend</h3>
            <div className="chart-legend-text">
                <div className="legend-item"><span className="legend-dot" style={{background: '#8884d8'}}></span>Plan</div>
                <div className="legend-item"><span className="legend-dot" style={{background: '#82ca9d'}}></span>Actual</div>
            </div>
          </div>
          <div className="trend-chart-container"><ChartCanvas type="line" data={trendData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} height="200px" /></div>
        </div>
      </div>
      <div className="division-main-grid">
        {teams.map(team => (
          <TeamCard
            key={team.id}
            team={team}
            tasks={allTasks.filter(t => t.team === team.name)}
            targetYear={targetYear}
            onGoToTeam={onGoToTeam}
          />
        ))}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.data.organization.departments[0].id === nextProps.data.organization.departments[0].id &&
    prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.targetYear === nextProps.targetYear;
});
//0
//2601080127

const MemberDashboardV2: React.FC<{ tasks: Task[], startMonth: string, endMonth: string, onDrillDown: (tasks: Task[]) => void, onNavigateToIssue: (task: Task) => void }> = React.memo(({ tasks, startMonth, endMonth, onDrillDown, onNavigateToIssue }) => {
  const filteredTasks = tasks;
  const [workloadFilter, setWorkloadFilter] = useState<'all' | 'active' | 'completed'>('all');
  const today = new Date().toISOString().split('T')[0];

  // ✅ 담당자 뷰 집계는 Task Code 기준
  const { counts: statusCounts, totalTaskCode } = useMemo(() => calculateTaskCodeStats(filteredTasks), [filteredTasks]);
  const totalTaskCodeCount = totalTaskCode || 1;

  const donutData = { labels: ['Finished', 'On-Going', 'Delayed', 'Not Started'], datasets: [{ data: [statusCounts['completed'], statusCounts['in-progress'], statusCounts['delayed'], statusCounts['not-started']], backgroundColor: ['#d9534f', '#5bc0de', '#f0ad4e', '#e2e3e5'], borderWidth: 0, }] };
  
  // Trend는 MH 기준이므로 기존 로직 유지
  const overallTrend = useMemo(() => calculateMonthlyTrends(filteredTasks, parseInt(startMonth.split('-')[0])), [filteredTasks, startMonth]);
  const trendData = { labels: overallTrend.labels.map(l => l.slice(5)), datasets: [{ label: 'Plan', data: overallTrend.planned, borderColor: '#8884d8', backgroundColor: 'rgba(136, 132, 216, 0.2)', fill: true, tension: 0.4 }, { label: 'Actual', data: overallTrend.actual, borderColor: '#82ca9d', backgroundColor: 'rgba(130, 202, 157, 0.2)', fill: true, tension: 0.4 }] };
  
  // 비율 계산 함수
  const getPct = (val: number) => ((val / totalTaskCodeCount) * 100).toFixed(1);

  const delayedStartTasks = filteredTasks.filter(task => { const planStart = getCurrentPlan(task).startDate; return task.status === 'not-started' && planStart && planStart < today; });
  const overdueCompletionTasks = filteredTasks.filter(task => { const planEnd = getCurrentPlan(task).endDate; return ['in-progress', 'delayed'].includes(task.status) && planEnd && planEnd < today; });
  const tasksDueSoon = filteredTasks.filter(task => { const planEnd = getCurrentPlan(task).endDate; if (!['in-progress', 'delayed'].includes(task.status) || !planEnd) return false; const diffDays = dateDiffInDays(planEnd, today); return diffDays >= 0 && diffDays <= 7; });
  const tasksWithUnreviewedIssues = filteredTasks.filter(task => task.monthlyIssues.some(issue => !issue.reviewed));

  const tasksWithReviewOpinions = filteredTasks.filter(task => 
    task.monthlyIssues.some(issue => 
      issue.replies && issue.replies.some(reply => !reply.checked)
    )
  );

  const inProgressCount = filteredTasks.filter(t => ['in-progress', 'delayed'].includes(t.status)).length;
  const completedCount = filteredTasks.filter(t => t.status === 'completed').length;
  const totalCount = filteredTasks.length;
  const completionRate = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(0) : '0';
  const totalPlanHours = filteredTasks.reduce((sum, t) => sum + hhmmToNumber(getCurrentPlan(t).hours), 0);
  const totalActualHours = filteredTasks.reduce((sum, t) => sum + hhmmToNumber(t.actual.hours), 0);
  const hourRatio = totalPlanHours > 0 ? ((totalActualHours / totalPlanHours) * 100).toFixed(0) : '0';

  const calendarBase = useMemo(() => {
    const labels: string[] = []; const keys: string[] = [];
    let current = new Date(startMonth + '-01'); const end = new Date(endMonth + '-01');
    let loopCount = 0;
    while (current <= end && loopCount < 36) {
      const y = current.getFullYear(); const m = current.getMonth() + 1; const mm = m < 10 ? `0${m}` : `${m}`; const key = `${y}-${mm}`; keys.push(key);
      const startYear = parseInt(startMonth.split('-')[0]); const endYear = parseInt(endMonth.split('-')[0]);
      if (startYear !== endYear) { labels.push(`${y.toString().slice(2)}.${mm}`); } else { labels.push(`${m}월`); }
      current.setMonth(current.getMonth() + 1); loopCount++;
    }
    return { labels, keys };
  }, [startMonth, endMonth]);

  const startCompleteData = useMemo(() => {
    const monthlyStart = new Array(calendarBase.keys.length).fill(0); const monthlyComplete = new Array(calendarBase.keys.length).fill(0);
    filteredTasks.forEach(task => {
      const planStart = getCurrentPlan(task).startDate; if (planStart) { const bucketIndex = calendarBase.keys.indexOf(planStart.substring(0, 7)); if (bucketIndex >= 0) monthlyStart[bucketIndex]++; }
      const actualEnd = task.actual.endDate; if (actualEnd && task.status === 'completed') { const bucketIndex = calendarBase.keys.indexOf(actualEnd.substring(0, 7)); if (bucketIndex >= 0) monthlyComplete[bucketIndex]++; }
    });
    return { labels: calendarBase.labels, datasets: [{ label: '착수 건수', data: monthlyStart, backgroundColor: '#6f42c1' }, { label: '완료 건수', data: monthlyComplete, backgroundColor: '#28a745' }] };
  }, [filteredTasks, calendarBase]);

  const { workloadData, filteredTotalPlan, filteredTotalActual } = useMemo(() => {
    const workloadTasks = filteredTasks.filter(t => { if (workloadFilter === 'all') return true; if (workloadFilter === 'active') return ['in-progress', 'delayed'].includes(t.status); if (workloadFilter === 'completed') return t.status === 'completed'; return true; });
    const categoryStats: { [key: string]: { plan: number, actual: number } } = {};
    workloadTasks.forEach(task => { const cat = `${task.category1} (${(categoryCodeMapping.category1 as any)[task.category1] || 'ETC'})`; if (!categoryStats[cat]) categoryStats[cat] = { plan: 0, actual: 0 }; categoryStats[cat].plan += hhmmToNumber(getCurrentPlan(task).hours); categoryStats[cat].actual += hhmmToNumber(task.actual.hours); });
    const labels = Object.keys(categoryStats);
    const data = { labels: labels, datasets: [{ label: '계획시수', data: labels.map(l => categoryStats[l].plan), backgroundColor: '#6f42c1' }, { label: '실적시수', data: labels.map(l => categoryStats[l].actual), backgroundColor: '#28a745' }] };
    const fTotalPlan = workloadTasks.reduce((sum, t) => sum + hhmmToNumber(getCurrentPlan(t).hours), 0); const fTotalActual = workloadTasks.reduce((sum, t) => sum + hhmmToNumber(t.actual.hours), 0);
    return { workloadData: data, filteredTotalPlan: fTotalPlan, filteredTotalActual: fTotalActual };
  }, [filteredTasks, workloadFilter]);

  // Chart.js 내부 레전드 끄기
  const barOptions1 = useMemo(() => ({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { drawBorder: false } }, x: { grid: { display: false } } }, maintainAspectRatio: false, barPercentage: 0.6 }), []);
  const barOptions2 = useMemo(() => ({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: '시간 (시)' } }, x: { grid: { display: false } } }, maintainAspectRatio: false, barPercentage: 0.6 }), []);

  const renderDelayBadge = (days: number) => {
    let bgColor, textColor;
    if (days <= 7) { bgColor = '#d3f9d8'; textColor = '#2b8a3e'; } else if (days <= 14) { bgColor = '#ffe8cc'; textColor = '#e8590c'; } else { bgColor = '#ffe3e3'; textColor = '#c92a2a'; }
    return (<span style={{ backgroundColor: bgColor, color: textColor, padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600', marginLeft: '8px', flexShrink: 0, display: 'inline-block', lineHeight: '1.4' }}> +{days}일 </span>);
  };

  return (
    <div className="division-dashboard">
      <div className="division-sidebar-panel">
        <div className="division-panel-card">
          <h3 className="panel-title">Progress and Status (Task Code)</h3>
          <div className="overall-donut-container">
              <ChartCanvas type="doughnut" data={donutData} options={{ cutout: '50%', plugins: { legend: { display: false } } }} height="220px" />
              <div className="overall-center-text">
                  <span className="overall-total">{totalTaskCode}</span>
                  <div style={{fontSize: '0.8rem', color: '#888'}}>Task Code</div>
              </div>
          </div>
           <div className="metric-summary-grid">
            <div className="metric-box"><span className="metric-label">Finished</span><span className="metric-val" style={{ color: '#d9534f' }}>{statusCounts['completed']}</span><span className="metric-pct">({getPct(statusCounts['completed'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">On-Going</span><span className="metric-val" style={{ color: '#5bc0de' }}>{statusCounts['in-progress']}</span><span className="metric-pct">({getPct(statusCounts['in-progress'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">Delayed</span><span className="metric-val" style={{ color: '#f0ad4e' }}>{statusCounts['delayed']}</span><span className="metric-pct">({getPct(statusCounts['delayed'])}%)</span></div>
            <div className="metric-box"><span className="metric-label">Not Started</span><span className="metric-val" style={{ color: '#adb5bd' }}>{statusCounts['not-started']}</span><span className="metric-pct">({getPct(statusCounts['not-started'])}%)</span></div>
          </div>
        </div>
        <div className="division-panel-card" style={{ flexGrow: 1 }}>
          <div className="card-header-row">
            <h3 className="panel-title" style={{ borderBottom: 'none', marginBottom: 0 }}>Man-hour Trend</h3>
            <div className="chart-legend-text">
                <div className="legend-item"><span className="legend-dot" style={{background: '#8884d8'}}></span>Plan</div>
                <div className="legend-item"><span className="legend-dot" style={{background: '#82ca9d'}}></span>Actual</div>
            </div>
          </div>
          <div className="trend-chart-container"><ChartCanvas type="line" data={trendData} options={{ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} height="200px" /></div>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', position: 'static' }}>
      <div className="attention-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', marginBottom: '0', position: 'static' }}>
        <div className="attention-card" onClick={() => onDrillDown(delayedStartTasks)}><div className="att-header"><span className="att-icon">⏰</span> <span className="att-title">시작 지연 Task</span> <span className="att-count">{delayedStartTasks.length}</span></div><div className="att-content">{delayedStartTasks.length === 0 ? <p className="att-empty">해당 Task가 없습니다.</p> : <ul className="att-list">{delayedStartTasks.map(t => { const planStart = getCurrentPlan(t).startDate; const delayDays = planStart ? dateDiffInDays(today, planStart) : 0; return <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }} title={t.name}>{t.name}</span>{renderDelayBadge(delayDays)}</li>; })}</ul>}</div></div>
        
        <div className="attention-card" onClick={() => onDrillDown(overdueCompletionTasks)}><div className="att-header"><span className="att-icon">🔥</span> <span className="att-title">종료 지연 Task</span> <span className="att-count">{overdueCompletionTasks.length}</span></div><div className="att-content">{overdueCompletionTasks.length === 0 ? <p className="att-empty">해당 Task가 없습니다.</p> : <ul className="att-list">{overdueCompletionTasks.map(t => { const planEnd = getCurrentPlan(t).endDate; const delayDays = planEnd ? dateDiffInDays(today, planEnd) : 0; return <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }} title={t.name}>{t.name}</span>{renderDelayBadge(delayDays)}</li>; })}</ul>}</div></div>
        
        <div className="attention-card" onClick={() => onDrillDown(tasksDueSoon)}><div className="att-header"><span className="att-icon">⏳</span> <span className="att-title">마감 임박 Task (7일 이내)</span> <span className="att-count">{tasksDueSoon.length}</span></div><div className="att-content">{tasksDueSoon.length === 0 ? <p className="att-empty">해당 Task가 없습니다.</p> : <ul className="att-list">{tasksDueSoon.map(t => <li key={t.id}>{t.name}</li>)}</ul>}</div></div>

        {/* 4. 검토 의견 알림 */}
        <div className="attention-card" onClick={() => onDrillDown(tasksWithReviewOpinions)}>
          <div className="att-header">
            <span className="att-icon">💬</span> 
            <span className="att-title">검토 의견 알림</span> 
            <span className="att-count">{tasksWithReviewOpinions.length}</span>
          </div>
          <div className="att-content">
            {tasksWithReviewOpinions.length === 0 ? (
              <p className="att-empty">확인할 새 의견이 없습니다.</p>
            ) : (
              <ul className="att-list issues">
                {tasksWithReviewOpinions.map(t => {
                   let unreadCount = 0;
                   let latestReplyText = "";
                   t.monthlyIssues.forEach(issue => {
                     if (issue.replies) {
                       issue.replies.forEach(r => {
                         if (!r.checked) {
                           unreadCount++;
                           latestReplyText = typeof r === 'object' ? r.text : r;
                         }
                       });
                     }
                   });
                   return (
                     <li key={t.id}
                         onClick={(e) => { e.stopPropagation(); onNavigateToIssue(t); }} 
                         style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                         onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                         onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                     >
                       <div className="att-issue-row">
                         <div style={{ maxWidth: '75%', overflow: 'hidden' }}>
                           <div className="att-issue-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#007bff', fontWeight: 'bold' }}>{t.name}</div>
                           {latestReplyText && (
                             <div style={{ fontSize: '0.8rem', color: '#868e96', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                               ↳ {latestReplyText}
                             </div>
                           )}
                           <div className="att-issue-assignee">미확인 댓글 {unreadCount}건</div>
                         </div>
                         <span className="att-issue-badge" style={{ backgroundColor: '#e7f5ff', color: '#004085' }}>New</span>
                       </div>
                     </li>
                   );
                })}
              </ul>
            )}
          </div>
        </div>
        
        {/* 5. 미검토 이슈 */}
        <div className="attention-card" onClick={() => onDrillDown(tasksWithUnreviewedIssues)}>
            <div className="att-header">
                <span className="att-icon">📝</span> 
                <span className="att-title">미검토 이슈 Task</span> 
                <span className="att-count">{tasksWithUnreviewedIssues.length}</span>
            </div>
            <div className="att-content">
                {tasksWithUnreviewedIssues.length === 0 ? (
                    <p className="att-empty">해당 Task가 없습니다.</p>
                ) : (
                    <ul className="att-list issues">
                        {tasksWithUnreviewedIssues.map(t => {
                            const unreviewedItems = t.monthlyIssues.filter(i => !i.reviewed);
                            const latestIssue = unreviewedItems.length > 0 ? unreviewedItems[unreviewedItems.length - 1] : null;
                            return (
                                <li key={t.id}
                                    onClick={(e) => { e.stopPropagation(); onNavigateToIssue(t); }}
                                    style={{ cursor: 'pointer', transition: 'background-color 0.2s' }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <div className="att-issue-row">
                                        <div style={{ maxWidth: '85%', overflow: 'hidden' }}>
                                            <div className="att-issue-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#007bff', fontWeight: 'bold' }}>{t.name}</div>
                                            {latestIssue && (
                                                <div style={{ fontSize: '0.8rem', color: '#868e96', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    - {latestIssue.issue}
                                                </div>
                                            )}
                                            <div className="att-issue-assignee">{t.assigneeName}</div>
                                        </div>
                                        <span className="att-issue-badge">{unreviewedItems.length}개</span>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
      </div>
      <div className="division-main-grid" style={{ gridTemplateColumns: '1fr', gap: '20px', marginTop: '20px', maxHeight: '878px', overflowY: 'auto', alignItems: 'start', alignContent: 'start' }}>
        <div className="dashboard-card" style={{ height: '336px' }}>
          <div className="card-header-row">
            <h3 className="card-title">월별 착수/완료 현황 <span className="sub-title">({startMonth} ~ {endMonth})</span></h3>
            <div className="chart-legend-text">
              <div className="legend-item"><span className="legend-dot" style={{background: '#6f42c1'}}></span>착수 건수</div>
              <div className="legend-item"><span className="legend-dot" style={{background: '#28a745'}}></span>완료 건수</div>
            </div>
          </div>
          <div style={{ height: '250px' }}><ChartCanvas type="bar" data={startCompleteData} options={barOptions1} /></div>
        </div>
        <div className="dashboard-card" style={{ height: '336px' }}>
          <div className="card-header-row">
            <h3 className="card-title">업무별 계획/실적 시수</h3>
            <div className="chart-header-controls">
                <div className="chart-filter-buttons" style={{ marginRight: '15px' }}>
                    <button onClick={() => setWorkloadFilter('all')} style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #ced4da', cursor: 'pointer', backgroundColor: workloadFilter === 'all' ? '#495057' : 'white', color: workloadFilter === 'all' ? 'white' : '#495057' }}>전체</button>
                    <button onClick={() => setWorkloadFilter('active')} style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #ced4da', cursor: 'pointer', backgroundColor: workloadFilter === 'active' ? '#5bc0de' : 'white', color: workloadFilter === 'active' ? 'white' : '#495057' }}>진행</button>
                    <button onClick={() => setWorkloadFilter('completed')} style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #ced4da', cursor: 'pointer', backgroundColor: workloadFilter === 'completed' ? '#28a745' : 'white', color: workloadFilter === 'completed' ? 'white' : '#495057' }}>완료</button>
                </div>
                <div className="chart-legend-text">
                    <div className="legend-item"><span className="legend-dot" style={{background: '#6f42c1'}}></span>계획</div>
                    <div className="legend-item"><span className="legend-dot" style={{background: '#28a745'}}></span>실적</div>
                </div>
            </div>
          </div>
          <div style={{ height: '250px' }}><ChartCanvas type="bar" data={workloadData} options={barOptions2} /></div>
        </div>
      </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.tasks.length === nextProps.tasks.length &&
    prevProps.startMonth === nextProps.startMonth &&
    prevProps.endMonth === nextProps.endMonth;
});
  
  const OrgManagementTab = ({ organization, onAdd, onDelete, onUpdateOrg }: { organization: Organization, onAdd: Function, onDelete: Function, onUpdateOrg: (org: Organization) => void }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  // 행 개수 계산 (rowspan용)
  const getRowSpan = useCallback((dept: Department) => {
    let count = 0;
    if (dept.teams.length === 0) return 1;
    dept.teams.forEach(team => {
      if (team.groups.length === 0) {
        count += 1;
      } else {
        count += team.groups.length;
      }
    });
    return count || 1;
  }, []);

  const getTeamRowSpan = useCallback((team: Team) => {
    return team.groups.length || 1;
  }, []);

  // 조직명/코드 변경 핸들러
  const handleChange = useCallback((level: 1 | 2 | 3, id: string, field: 'name' | 'code', value: string, deptId?: string, teamId?: string) => {
    let newOrg = JSON.parse(JSON.stringify(organization));
    
    // 코드 중복 체크
    if (field === 'code') {
      if (level === 1) {
        // Lv.1 코드 중복 체크 (다른 실과 비교)
        const duplicate = newOrg.departments.find((d: Department, idx: number) => d.id !== id && (d as any).code === value && value.trim() !== '');
        if (duplicate) {
          alert(`Lv.1 코드 "${value}"는 이미 사용 중입니다.`);
          return;
        }
      } else if (level === 2 && deptId) {
        // Lv.2 코드 중복 체크 (같은 실 내 다른 팀과 비교)
        const dept = newOrg.departments.find((d: Department) => d.id === deptId);
        const duplicate = dept?.teams.find((t: Team, idx: number) => t.id !== id && (t as any).code === value && value.trim() !== '');
        if (duplicate) {
          alert(`Lv.2 코드 "${value}"는 같은 실 내에서 이미 사용 중입니다.`);
          return;
        }
      } else if (level === 3 && deptId && teamId) {
        // Lv.3 코드 중복 체크 (같은 팀 내 다른 그룹과 비교)
        const dept = newOrg.departments.find((d: Department) => d.id === deptId);
        const team = dept?.teams.find((t: Team) => t.id === teamId);
        const duplicate = team?.groups.find((g: Group, idx: number) => g.id !== id && (g as any).code === value && value.trim() !== '');
        if (duplicate) {
          alert(`Lv.3 코드 "${value}"는 같은 팀 내에서 이미 사용 중입니다.`);
          return;
        }
      }
    }
    
    if (level === 1) {
      const dept = newOrg.departments.find((d: Department) => d.id === id);
      if (dept) {
        if (field === 'name') {
          dept.name = value;
        } else if (field === 'code') {
          (dept as any).code = value;
        }
      }
    } else if (level === 2 && deptId) {
      const dept = newOrg.departments.find((d: Department) => d.id === deptId);
      const team = dept?.teams.find((t: Team) => t.id === id);
      if (team) {
        if (field === 'name') {
          team.name = value;
        } else if (field === 'code') {
          (team as any).code = value;
        }
      }
    } else if (level === 3 && deptId && teamId) {
      const dept = newOrg.departments.find((d: Department) => d.id === deptId);
      const team = dept?.teams.find((t: Team) => t.id === teamId);
      const group = team?.groups.find((g: Group) => g.id === id);
      if (group) {
        if (field === 'name') {
          group.name = value;
        } else if (field === 'code') {
          (group as any).code = value;
        }
      }
    }
    onUpdateOrg(newOrg);
  }, [organization, onUpdateOrg]);

  // 조직 데이터 내보내기
  const handleDownloadTemplate = () => {
    const wsData = [['Lv.1 코드', '*Lv.1 실', 'Lv.2 코드', '*Lv.2 팀', 'Lv.3 코드', '*Lv.3 그룹']];
    
    // 현재 조직 데이터를 평탄화하여 엑셀 데이터로 변환
    organization.departments.forEach((dept, deptIdx) => {
      const deptCode = (dept as any).code || String(deptIdx + 1).padStart(2, '0');
      
      if (dept.teams.length === 0) {
        // 실만 있고 팀이 없는 경우
        wsData.push([deptCode, dept.name, '', '', '', '']);
      } else {
        dept.teams.forEach((team, teamIdx) => {
          const teamCode = (team as any).code || String(teamIdx + 1).padStart(2, '0');
          
          if (team.groups.length === 0) {
            // 팀만 있고 그룹이 없는 경우
            wsData.push([deptCode, dept.name, teamCode, team.name, '', '']);
          } else {
            // 그룹이 있는 경우
            team.groups.forEach((group, groupIdx) => {
              const groupCode = (group as any).code || String(groupIdx + 1).padStart(2, '0');
              wsData.push([deptCode, dept.name, teamCode, team.name, groupCode, group.name]);
            });
          }
        });
      }
    });
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Organization_List");

    // 주의사항 시트 추가
    const noticeData = [
      ['조직 관리 템플릿 입력 주의사항'],
      ['- "*" 표시는 필수 입력입니다.'],
      ['- 코드는 자동 생성되며, 수동 입력도 가능합니다.'],
      ['- Lv.1 코드는 전체 조직에서 고유해야 합니다.'],
      ['- Lv.2 코드는 같은 Lv.1 내에서 고유해야 합니다.'],
      ['- Lv.3 코드는 같은 Lv.2 내에서 고유해야 합니다.'],
      ['- 빈 행은 무시됩니다.'],
    ];
    const noticeWs = XLSX.utils.aoa_to_sheet(noticeData);
    noticeWs['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, noticeWs, "주의사항");

    XLSX.writeFile(wb, `Organization_Master_Data.xlsx`);
  };

  // 엑셀 업로드
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];

        if (!jsonData || jsonData.length < 2) {
          alert('엑셀 파일에 데이터가 없습니다.');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // 헤더 제외하고 데이터 파싱
        const uploadData = jsonData.slice(1);
        const newOrg = JSON.parse(JSON.stringify(organization));
        const errors: string[] = [];
        let addedCount = 0;

        const norm = (v: any) => (v ?? '').toString().trim();

        // 코드 중복 체크를 위한 맵
        const deptCodeMap = new Map<string, string>(); // code -> deptId
        const teamCodeMap = new Map<string, Map<string, string>>(); // deptId -> (code -> teamId)
        const groupCodeMap = new Map<string, Map<string, Map<string, string>>>(); // deptId -> teamId -> (code -> groupId)

        uploadData.forEach((row, index) => {
          const rowIndex = index + 2; // 헤더 제외하고 실제 행 번호
          const [deptCode, deptName, teamCode, teamName, groupCode, groupName] = row;

          const deptCodeV = norm(deptCode);
          const deptNameV = norm(deptName);
          const teamCodeV = norm(teamCode);
          const teamNameV = norm(teamName);
          const groupCodeV = norm(groupCode);
          const groupNameV = norm(groupName);

          // 빈 행은 무시
          if (!deptNameV && !teamNameV && !groupNameV) {
            return;
          }

          // 필수 항목 체크
          if (!deptNameV) {
            errors.push(`행 ${rowIndex}: Lv.1 실명은 필수입니다.`);
            return;
          }

          // 실 찾기 또는 생성
          let dept = newOrg.departments.find((d: Department) => d.name === deptNameV);
          if (!dept) {
            const newDeptId = `dept-${Date.now()}-${Math.random()}`;
            dept = {
              id: newDeptId,
              name: deptNameV,
              teams: []
            };
            (dept as any).code = deptCodeV || '';
            newOrg.departments.push(dept);
            addedCount++;
          } else if (deptCodeV) {
            // 기존 실이 있고 코드가 제공된 경우 업데이트
            if ((dept as any).code !== deptCodeV) {
              // 중복 체크
              if (deptCodeMap.has(deptCodeV) && deptCodeMap.get(deptCodeV) !== dept.id) {
                errors.push(`행 ${rowIndex}: Lv.1 코드 "${deptCodeV}"는 이미 사용 중입니다.`);
                return;
              }
              (dept as any).code = deptCodeV;
            }
          }
          deptCodeMap.set((dept as any).code || '', dept.id);

          // 팀이 있는 경우
          if (teamNameV) {
            let team = dept.teams.find((t: Team) => t.name === teamNameV);
            if (!team) {
              const newTeamId = `team-${Date.now()}-${Math.random()}`;
              team = {
                id: newTeamId,
                name: teamNameV,
                groups: []
              };
              (team as any).code = teamCodeV || '';
              dept.teams.push(team);
              addedCount++;
            } else if (teamCodeV) {
              // 기존 팀이 있고 코드가 제공된 경우 업데이트
              if ((team as any).code !== teamCodeV) {
                // 중복 체크
                if (!teamCodeMap.has(dept.id)) {
                  teamCodeMap.set(dept.id, new Map());
                }
                const deptTeamMap = teamCodeMap.get(dept.id)!;
                if (deptTeamMap.has(teamCodeV) && deptTeamMap.get(teamCodeV) !== team.id) {
                  errors.push(`행 ${rowIndex}: Lv.2 코드 "${teamCodeV}"는 같은 실 내에서 이미 사용 중입니다.`);
                  return;
                }
                (team as any).code = teamCodeV;
              }
            }
            if (!teamCodeMap.has(dept.id)) {
              teamCodeMap.set(dept.id, new Map());
            }
            teamCodeMap.get(dept.id)!.set((team as any).code || '', team.id);

            // 그룹이 있는 경우
            if (groupNameV) {
              let group = team.groups.find((g: Group) => g.name === groupNameV);
              if (!group) {
                const newGroupId = `group-${Date.now()}-${Math.random()}`;
                group = {
                  id: newGroupId,
                  name: groupNameV,
                  members: []
                };
                (group as any).code = groupCodeV || '';
                team.groups.push(group);
                addedCount++;
              } else if (groupCodeV) {
                // 기존 그룹이 있고 코드가 제공된 경우 업데이트
                if ((group as any).code !== groupCodeV) {
                  // 중복 체크
                  if (!groupCodeMap.has(dept.id)) {
                    groupCodeMap.set(dept.id, new Map());
                  }
                  if (!groupCodeMap.get(dept.id)!.has(team.id)) {
                    groupCodeMap.get(dept.id)!.set(team.id, new Map());
                  }
                  const teamGroupMap = groupCodeMap.get(dept.id)!.get(team.id)!;
                  if (teamGroupMap.has(groupCodeV) && teamGroupMap.get(groupCodeV) !== group.id) {
                    errors.push(`행 ${rowIndex}: Lv.3 코드 "${groupCodeV}"는 같은 팀 내에서 이미 사용 중입니다.`);
                    return;
                  }
                  (group as any).code = groupCodeV;
                }
              }
              if (!groupCodeMap.has(dept.id)) {
                groupCodeMap.set(dept.id, new Map());
              }
              if (!groupCodeMap.get(dept.id)!.has(team.id)) {
                groupCodeMap.get(dept.id)!.set(team.id, new Map());
              }
              groupCodeMap.get(dept.id)!.get(team.id)!.set((group as any).code || '', group.id);
            }
          }
        });

        // 에러가 있으면 에러 모달 표시
        if (errors.length > 0) {
          setUploadErrors(errors);
          setIsErrorModalOpen(true);
        }

        if (addedCount > 0) {
          onUpdateOrg(newOrg);
          const successMsg = `${addedCount}개의 조직이 추가/업데이트되었습니다.`;
          if (errors.length > 0) {
            alert(successMsg + '\n\n일부 데이터에서 오류가 발생했습니다. 에러 상세 내용을 확인해주세요.');
          } else {
            alert(successMsg);
          }
        } else {
          if (errors.length > 0) {
            alert('일부 데이터에서 오류가 발생했습니다. 에러 상세 내용을 확인해주세요.');
          } else {
            alert('추가/업데이트된 조직이 없습니다.');
          }
        }

        // 파일 입력 초기화
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (error: any) {
        alert(`엑셀 파일 읽기 오류: ${error.message}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      alert('파일 읽기 오류가 발생했습니다.');
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
  };

  return (
    <div>
      <div className="admin-toolbar-row">
        <div>
          <h3 className="panel-title" style={{ border: 'none', marginBottom: '5px', color: '#333' }}>조직 관리 (Lv.1 /Lv.2/Lv.3)</h3>
          <p className="admin-description" style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: '#666' }}>
            실(Lv.1), 팀(Lv.2), 그룹(Lv.3)을 체계적으로 관리합니다. 조직을 삭제하면 연관된 Task도 함께 삭제됩니다.
          </p>
        </div>
        <div className="admin-toolbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate}>📥 내보내기</button>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
            📤 엑셀 업로드
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              style={{ display: 'none' }}
            />
          </label>
          <span className="toolbar-separator"></span>
          <button className="btn btn-primary btn-sm" onClick={() => onAdd('department', '새 실', {})}>+ 실 추가</button>
          <span className="toolbar-separator"></span>
          <button className="btn btn-success btn-sm" onClick={() => saveOrganizationToLocal(organization)}>💾 저장</button>
        </div>
      </div>

      <div className="table-container" style={{ marginTop: '20px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)', flex: 1 }}>
        <table className="cat-table">
          <thead>
            <tr>
              <th style={{width: '8%', color: '#333'}}>Lv.1 코드</th>
              <th style={{width: '15%', color: '#333'}}>Lv.1 실</th>
              <th style={{width: '8%', color: '#333'}}>Lv.2 코드</th>
              <th style={{width: '15%', color: '#333'}}>Lv.2 팀</th>
              <th style={{width: '8%', color: '#333'}}>Lv.3 코드</th>
              <th style={{width: '20%', color: '#333'}}>Lv.3 그룹</th>
              <th style={{width: '26%', color: '#333'}}>관리</th>
            </tr>
          </thead>
          <tbody>
            {organization.departments.length === 0 ? (
              <tr><td colSpan={7} style={{textAlign:'center', padding:'30px', color:'#999'}}>등록된 조직이 없습니다.</td></tr>
            ) : (
              organization.departments.map((dept, deptIdx) => {
                const deptSpan = getRowSpan(dept);
                // 코드가 저장되어 있으면 사용, 없으면 인덱스 기반 자동 생성
                const deptCode = (dept as any).code || String(deptIdx + 1).padStart(2, '0');
                
                // 실만 있고 하위가 없는 경우
                if (dept.teams.length === 0) {
                  return (
                    <tr key={dept.id} className="cat-row">
                      <td className="merged-cell code-cell"><input className="cat-input code-input" value={deptCode} onChange={(e) => handleChange(1, dept.id, 'code', e.target.value)} placeholder="코드" style={{textAlign: 'center'}} /></td>
                      <td className="merged-cell">
                        <input className="cat-input" value={dept.name} onChange={(e) => handleChange(1, dept.id, 'name', e.target.value)} placeholder="실명 입력" />
                        <button className="text-btn add" onClick={() => onAdd('team', '새 팀', { departmentId: dept.id })}>+ 팀 추가</button>
                      </td>
                      <td colSpan={5} style={{background:'#f9f9f9', textAlign:'center', color:'#ccc'}}>(팀 없음)</td>
                    </tr>
                  );
                }

                // 팀 순회
                return dept.teams.map((team, teamIdx) => {
                  const teamSpan = getTeamRowSpan(team);
                  // 코드가 저장되어 있으면 사용, 없으면 인덱스 기반 자동 생성
                  const teamCode = (team as any).code || String(teamIdx + 1).padStart(2, '0');
                  
                  // 팀만 있고 하위가 없는 경우
                  if (team.groups.length === 0) {
                    return (
                      <tr key={team.id} className="cat-row">
                        {teamIdx === 0 && <td rowSpan={deptSpan} className="merged-cell code-cell"><input className="cat-input code-input" value={deptCode} onChange={(e) => handleChange(1, dept.id, 'code', e.target.value)} placeholder="코드" style={{textAlign: 'center'}} /></td>}
                        {teamIdx === 0 && <td rowSpan={deptSpan} className="merged-cell">
                          <input className="cat-input" value={dept.name} onChange={(e) => handleChange(1, dept.id, 'name', e.target.value)} placeholder="실명 입력" />
                          <button className="text-btn add" onClick={() => onAdd('team', '새 팀', { departmentId: dept.id })}>+ 팀 추가</button>
                        </td>}
                        <td className="code-cell"><input className="cat-input code-input" value={teamCode} onChange={(e) => handleChange(2, team.id, 'code', e.target.value, dept.id)} placeholder="코드" style={{textAlign: 'center'}} /></td>
                        <td>
                          <input className="cat-input" value={team.name} onChange={(e) => handleChange(2, team.id, 'name', e.target.value, dept.id)} placeholder="팀명 입력" />
                          <button className="text-btn add" onClick={() => onAdd('group', '새 그룹', { departmentId: dept.id, teamId: team.id })}>+ 그룹 추가</button>
                        </td>
                        <td colSpan={2} style={{background:'#f9f9f9', textAlign:'center', color:'#ccc'}}>(그룹 없음)</td>
                        <td>
                          <button className="btn-action delete" onClick={() => onDelete('team', { departmentId: dept.id, teamId: team.id })}>🗑️ 팀 삭제</button>
                          {teamIdx === 0 && <div style={{marginTop:'5px', fontSize:'0.8rem'}}><button className="btn-action delete" onClick={() => onDelete('department', { departmentId: dept.id })} style={{color:'#007bff'}}>🚫 실 삭제</button></div>}
                        </td>
                      </tr>
                    );
                  }

                  // 그룹 순회
                  return team.groups.map((group, groupIdx) => {
                    // 코드가 저장되어 있으면 사용, 없으면 인덱스 기반 자동 생성
                    const groupCode = (group as any).code || String(groupIdx + 1).padStart(2, '0');
                    return (
                      <tr key={group.id} className="cat-row">
                        {teamIdx === 0 && groupIdx === 0 && <td rowSpan={deptSpan} className="merged-cell code-cell"><input className="cat-input code-input" value={deptCode} onChange={(e) => handleChange(1, dept.id, 'code', e.target.value)} placeholder="코드" style={{textAlign: 'center'}} /></td>}
                        {teamIdx === 0 && groupIdx === 0 && <td rowSpan={deptSpan} className="merged-cell">
                          <input className="cat-input" value={dept.name} onChange={(e) => handleChange(1, dept.id, 'name', e.target.value)} placeholder="실명 입력" />
                          <button className="text-btn add" onClick={() => onAdd('team', '새 팀', { departmentId: dept.id })}>+ 팀 추가</button>
                        </td>}
                        {groupIdx === 0 && <td rowSpan={teamSpan} className="code-cell"><input className="cat-input code-input" value={teamCode} onChange={(e) => handleChange(2, team.id, 'code', e.target.value, dept.id)} placeholder="코드" style={{textAlign: 'center'}} /></td>}
                        {groupIdx === 0 && <td rowSpan={teamSpan} style={{verticalAlign:'top'}}>
                          <input className="cat-input" value={team.name} onChange={(e) => handleChange(2, team.id, 'name', e.target.value, dept.id)} placeholder="팀명 입력" />
                          <button className="text-btn add" onClick={() => onAdd('group', '새 그룹', { departmentId: dept.id, teamId: team.id })}>+ 그룹 추가</button>
                        </td>}
                        <td className="code-cell"><input className="cat-input code-input" value={groupCode} onChange={(e) => handleChange(3, group.id, 'code', e.target.value, dept.id, team.id)} placeholder="코드" style={{textAlign: 'center'}} /></td>
                        <td><input className="cat-input" value={group.name} onChange={(e) => handleChange(3, group.id, 'name', e.target.value, dept.id, team.id)} placeholder="그룹명 입력" /></td>
                        <td>
                          <button className="btn-action delete" onClick={() => onDelete('group', { departmentId: dept.id, teamId: team.id, groupId: group.id })}>🗑️ 삭제</button>
                          {groupIdx === 0 && <div style={{display:'inline-block', marginLeft:'10px'}}><button className="btn-action delete" onClick={() => onDelete('team', { departmentId: dept.id, teamId: team.id })} style={{color:'#fd7e14', fontSize:'0.8rem'}}>🚫 팀 삭제</button></div>}
                        </td>
                      </tr>
                    );
                  });
                });
              })
            )}
          </tbody>
        </table>
      </div>
      <ErrorModal
        isOpen={isErrorModalOpen}
        title="엑셀 업로드 오류"
        errors={uploadErrors}
        onClose={() => setIsErrorModalOpen(false)}
      />
    </div>
  );
};

const ConfirmModal = ({ isOpen, message, onConfirm, onCancel, zIndex }: { isOpen: boolean; message: string; onConfirm: () => void; onCancel: () => void; zIndex?: number; }) => {
  if (!isOpen) return null;
  return (
    <div className="modal show" onClick={(e) => e.target === e.currentTarget && onCancel()} style={{ zIndex: zIndex || 3000 }}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <h3 className="modal-header">확인</h3>
        <div className="modal-body"><p style={{ whiteSpace: 'pre-line', fontSize: '1rem', color: '#333' }}>{message}</p></div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onCancel}>취소</button><button className="btn btn-primary" onClick={onConfirm}>삭제</button></div>
      </div>
    </div>
  );
};

const UserManagementTab = ({ organization, onUpdateOrg }: { organization: Organization, onUpdateOrg: (org: Organization) => void }) => {
  const allMembers = useMemo(() => {
    return organization.departments.flatMap(d => 
      d.teams.flatMap(t => 
        t.groups.flatMap(g => 
          g.members.map(m => ({ ...m, deptName: d.name, teamName: t.name, groupName: g.name, groupId: g.id, teamId: t.id, deptId: d.id }))
        )
      )
    );
  }, [organization]);

  const [editingMember, setEditingMember] = useState<any | null>(null);
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', loginId: '', password: '123', position: '선임연구원', role: 'member', deptId: '', teamId: '', groupId: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  const availableTeams = useMemo(() => {
    const deptId = editingMember?.deptId || newUser.deptId;
    if (!deptId) return [];
    const dept = organization.departments.find(d => d.id === deptId);
    return dept ? dept.teams : [];
  }, [organization, newUser.deptId, editingMember?.deptId]);

  const availableGroups = useMemo(() => {
    const teamId = editingMember?.teamId || newUser.teamId;
    if (!teamId) return [];
    for (const d of organization.departments) {
      const team = d.teams.find(t => t.id === teamId);
      if (team) return team.groups;
    }
    return [];
  }, [organization, newUser.teamId, editingMember?.teamId]);

  const handleSaveMember = () => {
    if (!editingMember) return;
    
    const isAdmin = editingMember.role === 'admin';
    const isDeptHead = editingMember.role === 'dept_head';
    const isTeamLeader = editingMember.role === 'team_leader';
    
    // 소속 검증
    if (!isAdmin && !editingMember.deptId) {
      alert('실(Department)은 필수 선택 항목입니다.');
      return;
    }
    if (!isAdmin && !isDeptHead && !editingMember.teamId) {
      alert('팀(Team)은 필수 선택 항목입니다.');
      return;
    }
    if (!isAdmin && !isDeptHead && !isTeamLeader && !editingMember.groupId) {
      alert('그룹(Group)은 필수 선택 항목입니다.');
      return;
    }
    
    const newOrg = JSON.parse(JSON.stringify(organization));
    
    // 기존 위치에서 사용자 찾기 및 제거
    let oldMember: Member | null = null;
    let oldGroup: any = null;
    outer:
    for (const d of newOrg.departments) {
      for (const t of d.teams) {
        for (const g of t.groups) {
          const idx = g.members.findIndex((m: Member) => m.id === editingMember.id);
          if (idx !== -1) {
            oldMember = g.members[idx];
            oldGroup = g;
            g.members.splice(idx, 1);
            break outer;
          }
        }
      }
    }
    
    if (!oldMember) {
      alert('사용자를 찾을 수 없습니다.');
      return;
    }
    
    // 새 소속 결정
    let targetGroupId = editingMember.groupId;
    if (isAdmin) {
      const dept = newOrg.departments?.[0];
      const team = dept?.teams?.[0];
      const group = team?.groups?.[0];
      if (!group?.id) {
        alert('조직 데이터(실/팀/그룹)가 비어 있어 관리자를 저장할 수 없습니다.');
        return;
      }
      targetGroupId = group.id;
    } else if (isDeptHead) {
      const dept = newOrg.departments.find((d: any) => d.id === editingMember.deptId);
      const team = dept?.teams?.[0];
      const group = team?.groups?.[0];
      if (!group?.id) {
        alert('선택한 실에 팀/그룹이 없어 실장을 저장할 수 없습니다.');
        return;
      }
      targetGroupId = group.id;
    } else if (isTeamLeader) {
      const dept = newOrg.departments.find((d: any) => d.id === editingMember.deptId);
      const team = dept?.teams?.find((t: any) => t.id === editingMember.teamId);
      const group = team?.groups?.[0];
      if (!group?.id) {
        alert('선택한 팀에 그룹이 없어 팀장을 저장할 수 없습니다.');
        return;
      }
      targetGroupId = group.id;
    }
    
    // 새 위치에 사용자 추가
    let added = false;
    outerLoop:
    for (const d of newOrg.departments) {
      for (const t of d.teams) {
        for (const g of t.groups) {
          if (g.id === targetGroupId) {
            g.members.push({
              ...oldMember,
              name: editingMember.name,
              position: editingMember.position,
              loginId: editingMember.loginId,
              password: editingMember.password,
              role: editingMember.role as UserRole
            });
            added = true;
            break outerLoop;
          }
        }
      }
    }
    
    if (added) {
      onUpdateOrg(newOrg);
      setEditingMember(null);
      alert('사용자 정보가 수정되었습니다.');
    } else {
      alert('소속 그룹을 찾을 수 없습니다.');
    }
  };
  
  const handleAddMember = () => {
    const isAdmin = newUser.role === 'admin';
    const isDeptHead = newUser.role === 'dept_head';
    const isTeamLeader = newUser.role === 'team_leader';

    if (!newUser.name || !newUser.loginId) {
      alert('이름, ID는 필수 입력 항목입니다.');
      return;
    }
    if (!isAdmin && !newUser.deptId) { alert('실(Department)은 필수 선택 항목입니다.'); return; }
    if (!isAdmin && !isDeptHead && !newUser.teamId) { alert('팀(Team)은 필수 선택 항목입니다.'); return; }
    if (!isAdmin && !isDeptHead && !isTeamLeader && !newUser.groupId) { alert('그룹(Group)은 필수 선택 항목입니다.'); return; }
    if (allMembers.some(m => m.loginId === newUser.loginId)) { alert('이미 존재하는 ID입니다.'); return; }
    const newOrg = JSON.parse(JSON.stringify(organization));
    let added = false;

    // 저장 위치 결정:
    // - admin: 조직 선택 없이도 추가 가능 → 첫 번째 Dept/Team/Group에 자동 배치
    // - dept_head(실장): 선택한 Dept의 첫 Team/Group에 자동 배치
    // - team_leader: 그룹 선택 비활성 → 선택된 팀의 첫 그룹에 자동 배치
    // - 그 외: 선택된 그룹에 배치
    let targetGroupId = newUser.groupId;
    if (isAdmin) {
      const dept = newOrg.departments?.[0];
      const team = dept?.teams?.[0];
      const group = team?.groups?.[0];
      if (!group?.id) {
        alert('조직 데이터(실/팀/그룹)가 비어 있어 관리자를 추가할 수 없습니다.');
        return;
      }
      targetGroupId = group.id;
    } else if (isDeptHead) {
      const dept = newOrg.departments.find((d: any) => d.id === newUser.deptId);
      const team = dept?.teams?.[0];
      const group = team?.groups?.[0];
      if (!group?.id) { alert('선택한 실에 팀/그룹이 없어 실장을 추가할 수 없습니다.'); return; }
      targetGroupId = group.id;
    } else if (isTeamLeader) {
      // 선택된 팀의 첫 그룹
      const dept = newOrg.departments.find((d: any) => d.id === newUser.deptId);
      const team = dept?.teams?.find((t: any) => t.id === newUser.teamId);
      const group = team?.groups?.[0];
      if (!group?.id) {
        alert('선택한 팀에 그룹이 없어 팀장을 추가할 수 없습니다.');
        return;
      }
      targetGroupId = group.id;
    }

    outerLoop:
    for (const d of newOrg.departments) {
      for (const t of d.teams) {
        for (const g of t.groups) {
          if (g.id === targetGroupId) {
            const newMemberId = `emp_${Date.now()}`;
            g.members.push({
              id: newMemberId,
              name: newUser.name,
              position: newUser.position,
              loginId: newUser.loginId,
              password: newUser.password,
              role: newUser.role as UserRole
            });
            added = true;
            break outerLoop;
          }
        }
      }
    }
    if (added) {
      onUpdateOrg(newOrg);
      setAddModalOpen(false);
      setNewUser({ name: '', loginId: '', password: '123', position: '선임연구원', role: 'member', deptId: '', teamId: '', groupId: '' });
      alert('사용자가 추가되었습니다.');
    } else {
      alert('소속 그룹을 찾을 수 없습니다.');
    }
  };

  const handleDownloadTemplate = () => {
    const wsData = [['*이름', '*ID', '*비밀번호', '*실', '*팀', '*그룹', '직책', '*권한']];
    
    // 현재 마스터 데이터를 엑셀 데이터로 변환
    allMembers.forEach(member => {
      wsData.push([
        member.name,
        member.loginId,
        member.password || '',
        member.deptName,
        member.teamName,
        member.groupName,
        member.position,
        (member.role === 'dept_head' || member.position?.includes('실장'))
          ? '실장'
          : member.role === 'admin'
            ? '관리자'
            : member.role === 'team_leader'
              ? '팀장'
              : member.role === 'group_leader'
                ? '그룹장'
                : '팀원'
      ]);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "User_List");

    // ✅ 주의사항 시트 추가
    const noticeData = [
      ['사용자 템플릿 입력 주의사항'],
      ['- "*" 표시는 필수 입력입니다.'],
      ['- 권한 값: 관리자 /실장 / 팀장 / 그룹장 / 팀원'],
      ['- 실(Department)은 항상 정확히 입력해야 합니다.'],
      ['- 권한이 "실장"이 포함된 경우: 팀, 그룹은 "-" 로 입력하세요. (시스템이 자동으로 소속을 배치합니다)'],
      ['- 권한이 "팀장"인 경우: 그룹은 "-" 로 입력하세요. (시스템이 선택한 팀의 첫 그룹으로 자동 배치합니다)'],
      ['- ID는 중복될 수 없습니다.'],
    ];
    const noticeWs = XLSX.utils.aoa_to_sheet(noticeData);
    noticeWs['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, noticeWs, "주의사항");

    XLSX.writeFile(wb, `User_Master_Data.xlsx`);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];

        if (!jsonData || jsonData.length < 2) {
          alert('엑셀 파일에 데이터가 없습니다.');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // 헤더 제외하고 데이터 파싱
        const uploadData = jsonData.slice(1);
        const newOrg = JSON.parse(JSON.stringify(organization));
        const errors: string[] = [];
        let addedCount = 0;
        let skippedCount = 0;

        // 기존 ID 목록 생성
        const existingLoginIds = new Set<string>();
        allMembers.forEach(m => {
          if (m.loginId) existingLoginIds.add(m.loginId);
        });

        const norm = (v: any) => (v ?? '').toString().trim();
        const isDash = (v: any) => norm(v) === '-';

        uploadData.forEach((row, index) => {
          const rowIndex = index + 2; // 헤더 제외하고 실제 행 번호
          const [name, loginId, password, deptName, teamName, groupName, position, roleText] = row;

          const nameV = norm(name);
          const loginIdV = norm(loginId);
          const deptNameV = norm(deptName);
          const teamNameV = norm(teamName);
          const groupNameV = norm(groupName);
          const positionV = norm(position);
          const roleTextV = norm(roleText);

          // 권한 텍스트를 role로 변환 (템플릿: 관리자/실장/팀장/그룹장/팀원)
          let role: UserRole = 'member';
          if (roleTextV === '관리자') role = 'admin';
          else if (roleTextV === '실장') role = 'dept_head';
          else if (roleTextV === '팀장') role = 'team_leader';
          else if (roleTextV === '그룹장') role = 'group_leader';
          else if (roleTextV === '팀원') role = 'member';

          const isDeptHead = roleTextV === '실장' || role === 'dept_head' || positionV.includes('실장');
          const isTeamLeader = role === 'team_leader';

          // 필수 항목 체크
          // - 실장: 팀/그룹은 "-" 허용
          // - 팀장: 그룹은 "-" 허용
          if (!nameV || !loginIdV || !deptNameV) {
            errors.push(`행 ${rowIndex}: 필수 항목(이름, ID, 실)이 누락되었습니다.`);
            skippedCount++;
            return;
          }
          if (!isDeptHead && !teamNameV) {
            errors.push(`행 ${rowIndex}: 필수 항목(팀)이 누락되었습니다.`);
            skippedCount++;
            return;
          }
          if (!isDeptHead && !isTeamLeader && !groupNameV) {
            errors.push(`행 ${rowIndex}: 필수 항목(그룹)이 누락되었습니다.`);
            skippedCount++;
            return;
          }

          // ID 중복 체크
          if (existingLoginIds.has(loginIdV)) {
            errors.push(`행 ${rowIndex}: ID "${loginIdV}"가 이미 존재합니다.`);
            skippedCount++;
            return;
          }

          // 조직 구조 찾기
          const dept = newOrg.departments.find((d: any) => d.name === deptNameV);
          if (!dept) {
            errors.push(`행 ${rowIndex}: 실 "${deptNameV}"을 찾을 수 없습니다.`);
            skippedCount++;
            return;
          }

          // 팀 결정
          let team: any = null;
          if (isDeptHead && (isDash(teamNameV) || !teamNameV)) {
            team = dept.teams?.[0] || null;
            if (!team) {
              errors.push(`행 ${rowIndex}: 실 "${deptNameV}"에 팀이 없어 실장 사용자를 추가할 수 없습니다.`);
              skippedCount++;
              return;
            }
          } else {
            team = dept.teams.find((t: any) => t.name === teamNameV);
            if (!team) {
              errors.push(`행 ${rowIndex}: 팀 "${teamNameV}"을 찾을 수 없습니다.`);
              skippedCount++;
              return;
            }
          }

          // 그룹 결정
          let group: any = null;
          if ((isDeptHead || isTeamLeader) && (isDash(groupNameV) || !groupNameV)) {
            group = team.groups?.[0] || null;
            if (!group) {
              errors.push(`행 ${rowIndex}: 팀 "${team.name}"에 그룹이 없어 사용자를 추가할 수 없습니다.`);
              skippedCount++;
              return;
            }
          } else {
            group = team.groups.find((g: any) => g.name === groupNameV);
            if (!group) {
              errors.push(`행 ${rowIndex}: 그룹 "${groupNameV}"을 찾을 수 없습니다.`);
              skippedCount++;
              return;
            }
          }

          // 사용자 추가
          const newMemberId = `emp_${Date.now()}_${index}`;
          group.members.push({
            id: newMemberId,
            name: nameV,
            loginId: loginIdV,
            password: norm(password) || '123',
            position: positionV || (roleTextV === '실장' ? '실장' : '선임연구원'),
            role
          });

          existingLoginIds.add(loginIdV);
          addedCount++;
        });

        if (errors.length > 0) {
          setUploadErrors(errors);
          setIsErrorModalOpen(true);
        }

        if (addedCount > 0) {
          onUpdateOrg(newOrg);
          alert(`${addedCount}명의 사용자가 추가되었습니다.${skippedCount > 0 ? ` (${skippedCount}건 건너뜀)` : ''}`);
        } else if (skippedCount > 0) {
          alert(`추가된 사용자가 없습니다. (${skippedCount}건 건너뜀)`);
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (error) {
        console.error('Excel upload error:', error);
        alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
  };

  const handleSave = () => {
    saveOrganizationToLocal(organization);
  };

  return (
    <div>
      <div className="admin-toolbar-row">
        <div>
          <h3 className="panel-title" style={{marginBottom: 0, borderBottom: 'none', paddingBottom: 0}}>사용자 및 권한 관리</h3>
        </div>
        <div className="admin-toolbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate}>📥 내보내기</button>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
            📤 엑셀 업로드
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              style={{ display: 'none' }}
            />
          </label>
          <button className="btn btn-primary btn-sm" onClick={() => setAddModalOpen(true)}>+ 인원 추가</button>
          <span className="toolbar-separator"></span>
          <button className="btn btn-success btn-sm" onClick={handleSave}>💾 저장</button>
        </div>
      </div>
      <table className="user-mgmt-table">
        <thead>
          <tr style={{background: '#f8f9fa', borderBottom: '2px solid #dee2e6'}}>
            <th style={{padding: '8px'}}>이름</th><th style={{padding: '8px'}}>ID</th><th style={{padding: '8px'}}>소속</th><th style={{padding: '8px'}}>직책</th><th style={{padding: '8px'}}>권한</th><th style={{padding: '8px', textAlign: 'center'}}>관리</th>
          </tr>
        </thead>
        <tbody>
          {allMembers.map(m => (
            <tr key={m.id} style={{borderBottom: '1px solid #f1f3f5'}}>
              <td style={{padding: '8px'}}>{m.name}</td>
              <td style={{padding: '8px'}}>{m.loginId}</td>
              <td style={{padding: '8px'}}>{m.teamName} &gt; {m.groupName}</td>
              <td style={{padding: '8px'}}>{m.position}</td>
              <td style={{padding: '8px'}}>
                <span
                  className={`role-badge ${
                    m.role === 'admin'
                      ? 'admin'
                      : (m.role === 'dept_head' || m.position?.includes('실장'))
                        ? 'dept'
                        : m.role === 'team_leader'
                          ? 'team'
                          : m.role === 'group_leader'
                            ? 'group'
                            : 'member'
                  }`}
                >
                  {m.role === 'admin'
                    ? '관리자'
                    : (m.role === 'dept_head' || m.position?.includes('실장'))
                      ? '실장'
                      : m.role === 'team_leader'
                        ? '팀장'
                        : m.role === 'group_leader'
                          ? '그룹장'
                          : '팀원'}
                </span>
              </td>
              <td style={{padding: '8px', textAlign: 'center'}}><button className="btn-sm btn-secondary" onClick={() => setEditingMember({...m, deptId: m.deptId, teamId: m.teamId, groupId: m.groupId})}>수정</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editingMember && (
        <div className="modal show" onClick={(e) => e.target === e.currentTarget && setEditingMember(null)}>
          <div className="modal-content">
            <h3>사용자 정보 수정</h3>
            <div className="form-group"><label className="form-label">이름</label><input className="form-input" value={editingMember.name} onChange={e => setEditingMember({...editingMember, name: e.target.value})} /></div>
            <div className="form-row"><div className="form-group"><label className="form-label">로그인 ID</label><input className="form-input" value={editingMember.loginId} onChange={e => setEditingMember({...editingMember, loginId: e.target.value})} /></div><div className="form-group"><label className="form-label">비밀번호</label><input className="form-input" value={editingMember.password} onChange={e => setEditingMember({...editingMember, password: e.target.value})} /></div></div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">직책</label><input className="form-input" value={editingMember.position} onChange={e => setEditingMember({...editingMember, position: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">시스템 권한</label><select className="form-input" value={editingMember.role} onChange={e => {
                const newRole = e.target.value;
                setEditingMember({...editingMember, role: newRole, teamId: newRole === 'admin' || newRole === 'dept_head' ? '' : editingMember.teamId, groupId: newRole === 'admin' || newRole === 'dept_head' || newRole === 'team_leader' ? '' : editingMember.groupId});
              }}><option value="member">팀원</option><option value="group_leader">그룹장</option><option value="team_leader">팀장</option><option value="dept_head">실장</option><option value="admin">관리자</option></select></div>
            </div>
            {/* 소속 선택 필드 */}
            {editingMember.role !== 'admin' && (
              <div className="form-group">
                <label className="form-label">실 *</label>
                <select className="form-input" value={editingMember.deptId || ''} onChange={e => setEditingMember({...editingMember, deptId: e.target.value, teamId: '', groupId: ''})}>
                  <option value="">선택</option>
                  {organization.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            {editingMember.role !== 'admin' && editingMember.role !== 'dept_head' && editingMember.deptId && (
              <div className="form-group">
                <label className="form-label">팀 *</label>
                <select className="form-input" value={editingMember.teamId || ''} onChange={e => setEditingMember({...editingMember, teamId: e.target.value, groupId: ''})}>
                  <option value="">선택</option>
                  {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {editingMember.role !== 'admin' && editingMember.role !== 'dept_head' && editingMember.role !== 'team_leader' && editingMember.teamId && (
              <div className="form-group">
                <label className="form-label">그룹 *</label>
                <select className="form-input" value={editingMember.groupId || ''} onChange={e => setEditingMember({...editingMember, groupId: e.target.value})}>
                  <option value="">선택</option>
                  {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setEditingMember(null)}>취소</button><button className="btn btn-primary" onClick={handleSaveMember}>저장</button></div>
          </div>
        </div>
      )}
      {isAddModalOpen && (
        <div className="modal show" onClick={(e) => e.target === e.currentTarget && setAddModalOpen(false)}>
            <div className="modal-content">
                <h3>새 사용자 추가</h3>
                {/* 시스템 권한 (상단/초록 영역 위치) */}
                <div style={{ marginBottom: '10px' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">시스템 권한</label>
                    <select
                      className="form-input"
                      value={newUser.role}
                      onChange={e => {
                        const nextRole = e.target.value as UserRole;
                        // 관리자 선택 시 소속 선택 불필요
                        if (nextRole === 'admin') {
                          setNewUser({ ...newUser, role: nextRole, deptId: '', teamId: '', groupId: '' });
                          return;
                        }
                        // 실장 선택 시 팀/그룹 선택 불필요 (자동 배치)
                        if (nextRole === 'dept_head') {
                          setNewUser({ ...newUser, role: nextRole, teamId: '', groupId: '' });
                          return;
                        }
                        // 팀장 선택 시 그룹 선택 비활성(그룹ID는 저장 시 자동 배치)
                        if (nextRole === 'team_leader') {
                          setNewUser({ ...newUser, role: nextRole, groupId: '' });
                          return;
                        }
                        setNewUser({ ...newUser, role: nextRole });
                      }}
                    >
                      <option value="member">팀원</option>
                      <option value="group_leader">그룹장</option>
                      <option value="team_leader">팀장</option>
                      <option value="dept_head">실장</option>
                      <option value="admin">관리자</option>
                    </select>
                    <small style={{ color: '#6c757d', fontSize: '0.8rem', marginTop: '6px', display: 'block' }}>
                      팀장 선택 시 그룹 선택은 비활성화됩니다. 실장 선택 시 팀/그룹은 자동 배치됩니다. 관리자 선택 시 소속 선택은 필요 없습니다.
                    </small>
                  </div>
                </div>
                <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '8px', marginBottom: '15px', border: '1px solid #e9ecef'}}>
                    <h4 style={{fontSize: '0.9rem', marginBottom: '10px', color: '#495057'}}>소속 선택</h4>
                    <div className="form-row">
                        <div className="form-group" style={{marginBottom: 0}}>
                          <label className="form-label">실 (Department)</label>
                          <select
                            className="form-input"
                            value={newUser.deptId}
                            onChange={e => setNewUser({...newUser, deptId: e.target.value, teamId: '', groupId: ''})}
                            disabled={newUser.role === 'admin'}
                          >
                            <option value="">선택</option>
                            {organization.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                        </div>
                        <div className="form-group" style={{marginBottom: 0}}>
                          <label className="form-label">팀 (Team)</label>
                          <select
                            className="form-input"
                            value={newUser.teamId}
                            onChange={e => setNewUser({...newUser, teamId: e.target.value, groupId: ''})}
                            disabled={!newUser.deptId || newUser.role === 'admin' || newUser.role === 'dept_head'}
                          >
                            <option value="">선택</option>
                            {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                    </div>
                    <div className="form-group" style={{marginTop: '10px', marginBottom: 0}}>
                      <label className="form-label">그룹 (Group)</label>
                      <select
                        className="form-input"
                        value={newUser.groupId}
                        onChange={e => setNewUser({...newUser, groupId: e.target.value})}
                        disabled={!newUser.teamId || newUser.role === 'team_leader' || newUser.role === 'dept_head' || newUser.role === 'admin'}
                      >
                        <option value="">선택</option>
                        {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                </div>
                <div className="form-group"><label className="form-label">이름</label><input className="form-input" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} placeholder="이름 입력" /></div>
                <div className="form-row"><div className="form-group"><label className="form-label">로그인 ID</label><input className="form-input" value={newUser.loginId} onChange={e => setNewUser({...newUser, loginId: e.target.value})} placeholder="ID 입력" /></div><div className="form-group"><label className="form-label">비밀번호</label><input className="form-input" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} placeholder="비밀번호" /></div></div>
                <div className="form-group">
                  <label className="form-label">직책</label>
                  <input className="form-input" value={newUser.position} onChange={e => setNewUser({...newUser, position: e.target.value})} placeholder="예: 선임연구원" />
                </div>
                <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>취소</button><button className="btn btn-primary" onClick={handleAddMember}>추가</button></div>
            </div>
        </div>
      )}
      <ErrorModal
        isOpen={isErrorModalOpen}
        title="엑셀 업로드 오류"
        errors={uploadErrors}
        onClose={() => setIsErrorModalOpen(false)}
      />
    </div>
  );
};

// ... (기존 UserManagementTab 컴포넌트 끝)

// --- [추가] Category Management Component 정의 시작 ---

// --- [수정] Category Management Component ---

// 트리 노드 타입 정의 (기존과 동일)
// --- [수정] Category Management Component ---

// 트리 노드 타입 정의
// --- [수정] Category Management Component ---

// 트리 노드 타입 정의
// --- [수정] Category Management Component ---

// 트리 노드 타입 정의
// --- [수정] Category Management Component ---

// 트리 노드 타입 정의
type CatNode = {
  id: string;
  code: string;
  name: string;
  children: CatNode[];
  level: 1 | 2 | 3;
};

// TreeNode 컴포넌트 (입력 포커스 유지용)
// 1199--- [수정] TreeNode 컴포넌트: 카드형 디자인 및 트리 연결선 적용 ---
const TreeNode = ({ 
  node, 
  onChange, 
  onAdd, 
  onDelete,
  isLast 
}: { 
  node: CatNode, 
  onChange: (id: string, field: 'code' | 'name', value: string) => void,
  onAdd: (parentId: string | null, level: 1 | 2 | 3) => void,
  onDelete: (id: string) => void,
  isLast?: boolean
}) => {
  return (
    <li className={`tree-node level-${node.level} ${isLast ? 'is-last' : ''}`}>
      {/* 카드형 디자인 적용 */}
      <div className="node-card">
        <div className="node-badge">
          {node.level === 1 ? 'Lv.1' : node.level === 2 ? 'Lv.2' : 'Lv.3'}
        </div>
        
        {/* 코드 입력 */}
        <div className="input-wrapper code-wrapper">
          <input 
            type="text" 
            className="node-input code"
            value={node.code}
            onChange={(e) => onChange(node.id, 'code', e.target.value)}
            placeholder="코드"
          />
        </div>

        <div className="separator">|</div>

        {/* 명칭 입력 */}
        <div className="input-wrapper name-wrapper">
          <input 
            type="text" 
            className="node-input name"
            value={node.name}
            onChange={(e) => onChange(node.id, 'name', e.target.value)}
            placeholder={node.level === 1 ? "대분류 명칭" : node.level === 2 ? "중분류 명칭" : "소분류 명칭"}
          />
        </div>

        {/* 액션 버튼 */}
        <div className="node-actions">
          {node.level < 3 && (
            <button 
              className="icon-btn add" 
              onClick={() => onAdd(node.id, (node.level + 1) as 2 | 3)} 
              title="하위 카테고리 추가"
            >
              ➕
            </button>
          )}
          <button 
            className="icon-btn delete" 
            onClick={() => onDelete(node.id)} 
            title="삭제"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* 하위 노드 렌더링 */}
      {node.children.length > 0 && (
        <ul className="tree-children">
          {node.children.map((child, idx) => (
            <TreeNode 
              node={child} 
              onChange={onChange}
              onAdd={onAdd}
              onDelete={onDelete}
              isLast={idx === node.children.length - 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
};
//1279


//2601071028
// [공통용 간단 모달 컴포넌트]
const SimpleConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }: any) => {
  if (!isOpen) return null;
  return (
    <div className="modal show" onClick={(e) => e.target === e.currentTarget && onCancel()} style={{zIndex: 9999}}>
      <div className="modal-content" style={{maxWidth: '400px'}}>
        <h3 className="modal-header" style={{color: '#333'}}>{title}</h3>
        <div className="modal-body">
          <p style={{whiteSpace: 'pre-line', fontSize: '1rem', color: '#333'}}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>취소</button>
          <button className="btn btn-primary" onClick={onConfirm}>확인</button>
        </div>
      </div>
    </div>
  );
};

// [에러/결과 메시지 표시 모달]
// - 통합 업로드 결과: 처리상태 내역 + 오류 사유를 분리 표시
// - 기존 사용처: errors 단일 배열(오류 목록)도 그대로 지원
const ErrorModal = ({
  isOpen,
  title,
  errors,
  statusLines,
  errorReasons,
  onClose
}: {
  isOpen: boolean;
  title: string;
  errors?: string[];
  statusLines?: string[];
  errorReasons?: string[];
  onClose: () => void;
}) => {
  const safeErrors = errors ?? [];
  const safeStatusLines = statusLines ?? [];
  const safeErrorReasons = errorReasons ?? [];
  const hasAnyContent = safeErrors.length > 0 || safeStatusLines.length > 0 || safeErrorReasons.length > 0;
  // ✅ 통합 업로드 결과는 항상 표시 (내용이 없어도 모달은 열림)
  const isIntegratedUpload = title === '통합 업로드 결과';
  if (!isOpen || (!isIntegratedUpload && !hasAnyContent)) return null;

  const normalizeLine = (line: string) => String(line ?? '').replace(/^\s*-\s*/, '').trim();
  const PAGE_SIZE = 50;
  const [visibleErrorCount, setVisibleErrorCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!isOpen) return;
    setVisibleErrorCount(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, title, safeErrors.length, safeErrorReasons.length]);

  return (
    <div className="modal show" style={{ zIndex: 10000 }}>
      <div
        className="modal-content"
        style={{
          maxWidth: '720px',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <h3 className="modal-header" style={{ color: '#007bff' }}>
          {title}
        </h3>

        <div className="modal-body" style={{ overflowY: 'auto' }}>
          {/* 처리상태 내역 */}
          {safeStatusLines.length > 0 && (
            <div
              style={{
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '4px',
                padding: '12px',
                marginBottom: '10px'
              }}
            >
              <p style={{ margin: 0, color: '#721c24', fontWeight: 'bold', marginBottom: '8px' }}>
                처리 상태
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', color: '#721c24' }}>
                {safeStatusLines.map((line, idx) => (
                  <li key={idx} style={{ marginBottom: '4px' }}>
                    {normalizeLine(line)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 오류 사유 - 통합 업로드 결과일 때는 항상 제목 표시 */}
          {isIntegratedUpload ? (
            <div
              style={{
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '4px',
                padding: '12px',
                marginBottom: '10px'
              }}
            >
              <p style={{ margin: 0, color: '#721c24', fontWeight: 'bold', marginBottom: '8px' }}>
                상세 오류 내역
              </p>
              {(safeErrorReasons.length > 0 || safeErrors.length > 0) ? (
                <>
                  <ul style={{ margin: 0, paddingLeft: '20px', color: '#721c24' }}>
                    {[...safeErrorReasons, ...safeErrors].slice(0, visibleErrorCount).map((err, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {err}
                      </li>
                    ))}
                  </ul>
                  {([...safeErrorReasons, ...safeErrors].length > visibleErrorCount) && (
                    <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setVisibleErrorCount((n) => n + PAGE_SIZE)}
                      >
                        더보기 (+{PAGE_SIZE})
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p style={{ margin: 0, color: '#721c24', paddingLeft: '20px', fontStyle: 'italic' }}>
                  오류 내역이 없습니다.
                </p>
              )}
            </div>
          ) : (
            (safeErrorReasons.length > 0 || safeErrors.length > 0) && (
              <div
                style={{
                  backgroundColor: '#f8d7da',
                  border: '1px solid #f5c6cb',
                  borderRadius: '4px',
                  padding: '12px',
                  marginBottom: '10px'
                }}
              >
                <p style={{ margin: 0, color: '#721c24', fontWeight: 'bold', marginBottom: '8px' }}>
                  상세 오류 내역
                </p>
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#721c24' }}>
                  {[...safeErrorReasons, ...safeErrors].slice(0, visibleErrorCount).map((err, idx) => (
                    <li key={idx} style={{ marginBottom: '4px' }}>
                      {err}
                    </li>
                  ))}
                </ul>
                {([...safeErrorReasons, ...safeErrors].length > visibleErrorCount) && (
                  <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setVisibleErrorCount((n) => n + PAGE_SIZE)}
                    >
                      더보기 (+{PAGE_SIZE})
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
};
//2601071028 
// ... (이전 import 및 타입 정의, CategoryManagementTab 등 기존 코드는 그대로 유지)
// ... imports (React, useState, useEffect, useCallback, useMemo 등 필요)

// -----------------------------------------------------------------------------
// [수정된 컴포넌트] OBS Management Tab (그리드 에디터 방식)
// -----------------------------------------------------------------------------

// 그리드 행을 위한 인터페이스 정의
// -----------------------------------------------------------------------------
// [수정된 컴포넌트] OBS Management Tab (Lv.2 팀 선택 기능 추가)
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// [수정된 컴포넌트] OBS Management Tab (Lv.3 업무 구분 선택 기능 추가)
// -----------------------------------------------------------------------------

interface FlatTableRow {
    id: number;
    lv1: string;
    lv1Code?: string;
    lv2: string;
    lv2Code?: string;
    lv3: string; // 이제 업무 구분이 들어갑니다 (Select 선택값)
    lv3Code?: string;
}

const OBSManagementTab = ({ 
  initialData, 
  onSave,
  organization
  }: { 
  initialData: CategoryMaster, 
  onSave: (newMaster: CategoryMaster) => void,
  organization: Organization 
  }) => {
  const FIXED_LV1_OPTIONS = ["1. 중점과제", "2. 지시과제", "3. 자체과제", "4. 현장지원", "5. 기타"];
  const [rows, setRows] = useState<FlatTableRow[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [obsSort, setObsSort] = useState<{ key: keyof FlatTableRow; direction: 'asc' | 'desc' } | null>(null);

  // Lv.3(업무 구분) 후보: "업무 구분" 탭에 등록된 Lv.3 전체(동일 명칭/다른 코드 중복 허용)
  const lv3Entries = useMemo(() => {
    const categoryMaster = organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
    const entries: Array<{ name: string; code: string; cat1: string; cat2: string }> = [];
    Object.keys(categoryMaster).forEach((cat1Key) => {
      const lv2Obj = categoryMaster[cat1Key] || {};
      const cat1Code = (categoryCodeMapping.category1 as any)[String(cat1Key).split(' (')[0]] || '';
      const lv2Keys = Object.keys(lv2Obj);
      lv2Keys.forEach((cat2Key, idx2) => {
        const lv3Array = (lv2Obj as any)[cat2Key];
        if (!Array.isArray(lv3Array)) return;
        lv3Array.forEach((lv3Name: string, idx3: number) => {
          const code = cat1Code
            ? `${cat1Code}.${String(idx2 + 1).padStart(2, '0')}.${String(idx3 + 1).padStart(2, '0')}`
            : '';
          entries.push({ name: String(lv3Name), code, cat1: String(cat1Key), cat2: String(cat2Key) });
        });
      });
    });
    return entries;
  }, [organization]);

  // Task 등록 시 저장된 "업무 코드 조합"을 우선 코드로 사용(중복/미등록 시에도 코드 표시 가능)
  const getPreferredLv3CodeFromTaskCatalog = useCallback((teamName: string, lv3Name: string): string => {
    const tName = String(teamName || '').trim();
    const name = String(lv3Name || '').trim();
    if (!tName || !name) return '';
    const team = organization.departments.flatMap(d => d.teams).find(t => t.name === tName);
    const list = (team as any)?.obsTaskCatalog as Array<any> | undefined;
    if (!Array.isArray(list)) return '';
    const codes = Array.from(new Set(list.filter(x => String(x?.task1 || '') === name).map(x => String(x?.lv3Code || '').trim()).filter(Boolean)));
    if (codes.length === 1) return codes[0];
    return '';
  }, [organization]);

  const resolveLv3Code = useCallback((lv3Name: string, preferredCode?: string) => {
    const name = String(lv3Name || '').trim();
    if (!name) return '';
    const matches = lv3Entries.filter(e => e.name === name);
    if (preferredCode && matches.some(m => m.code === preferredCode)) return preferredCode;
    if (matches.length === 1) return matches[0].code;
    // 중복(동일 명칭/다른 코드)인 경우는 사용자가 선택하도록 코드 자동 결정하지 않음
    return '';
  }, [lv3Entries]);

  const findLv3ByCode = useCallback((code: string) => {
    const c = String(code || '').trim();
    if (!c) return null;
    const hit = lv3Entries.find(e => e.code === c);
    return hit ?? null;
  }, [lv3Entries]);

  // OBS 코드 생성 헬퍼 함수
  const generateOBSCode = useCallback((lv1: string, lv2: string, lv3: string, existingRows: FlatTableRow[] = []): { lv1Code: string, lv2Code: string, lv3Code: string } => {
    // Lv.1 코드
    const lv1Code = obsCodeMapping.lv1[lv1 as keyof typeof obsCodeMapping.lv1] || '';
    
    // Lv.2 코드: 조직 관리 화면에서 설정한 팀 코드 사용 (일치 보장)
    let lv2Code = '';
    if (lv2) {
      // 조직 구조에서 해당 팀을 찾아 조직 관리에서 설정한 코드 사용
      let found = false;
      for (const dept of organization.departments) {
        for (let teamIdx = 0; teamIdx < dept.teams.length; teamIdx++) {
          const team = dept.teams[teamIdx];
          if (team.name === lv2) {
            // 조직 관리에서 설정한 코드가 있으면 우선 사용, 없으면 인덱스 기반 생성
            lv2Code = (team as any).code || String(teamIdx + 1).padStart(2, '0');
            found = true;
            break;
          }
        }
        if (found) break;
      }
      // 찾지 못한 경우에도 기존 매핑은 사용하지 않고 빈 문자열 유지 (조직 관리 코드만 사용)
    }
    
    // Lv.3 코드 (업무 구분 Lv.3에서 찾기 - categoryMaster에서 찾아야 함)
    const preferred = getPreferredLv3CodeFromTaskCatalog(lv2, lv3);
    const lv3Code = resolveLv3Code(lv3, preferred) || preferred;
    
    return { lv1Code, lv2Code, lv3Code };
  }, [organization, resolveLv3Code, getPreferredLv3CodeFromTaskCatalog]);

  // 1. 조직도에서 팀 목록 추출
  const teamOptions = useMemo(() => {
      const teams: string[] = [];
      organization.departments.forEach(dept => {
          dept.teams.forEach(team => {
              teams.push(team.name);
          });
      });
      return [...new Set(teams)].sort();
  }, [organization]);

  // [신규] 업무 구분(Work Classification)의 Lv.3 소분류 목록 추출 (OBS Lv.3는 업무 구분 Lv.3만 참조)
  const workOptions = useMemo(() => {
      const options = new Set<string>();
      
      // 업무 구분 데이터 가져오기 (organization의 첫 번째 팀의 categoryMaster 사용)
      const categoryMaster = organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
      
      // 모든 Lv.1의 모든 Lv.2의 모든 Lv.3 소분류 추출
      Object.values(categoryMaster).forEach(lv2Obj => {
          Object.values(lv2Obj).forEach(lv3Array => {
              if (Array.isArray(lv3Array)) {
                  lv3Array.forEach(lv3Item => options.add(lv3Item));
              }
          });
      });
      
      return [...options].sort();
  }, [organization]);

  // 2. 초기 데이터 평탄화
  useEffect(() => {
      const flatRows: FlatTableRow[] = [];
      let idCounter = 1;

    const normalizeLv1 = (lv1: string) => (lv1 === '4. 기타' ? '5. 기타' : lv1);

    if (Object.keys(initialData).length === 0) {
          FIXED_LV1_OPTIONS.forEach(lv1 => {
              const codes = generateOBSCode(lv1, '', '');
              flatRows.push({ id: idCounter++, lv1: lv1, lv1Code: codes.lv1Code, lv2: '', lv2Code: '', lv3: '', lv3Code: '' });
          });
      } else {
          const processedLv1 = new Set<string>();
          
          FIXED_LV1_OPTIONS.forEach(lv1Key => {
              processedLv1.add(lv1Key);
              const lv2Obj = initialData[lv1Key] || initialData[normalizeLv1(lv1Key)] || (lv1Key === '5. 기타' ? initialData['4. 기타'] : undefined);
              if (!lv2Obj || Object.keys(lv2Obj).length === 0) {
                  const codes = generateOBSCode(lv1Key, '', '');
                  flatRows.push({ id: idCounter++, lv1: lv1Key, lv1Code: codes.lv1Code, lv2: '', lv2Code: '', lv3: '', lv3Code: '' });
              } else {
                  Object.keys(lv2Obj).forEach(lv2Key => {
                      const lv3Array = lv2Obj[lv2Key];
                      if (lv3Array.length === 0) {
                          const codes = generateOBSCode(lv1Key, lv2Key, '');
                          flatRows.push({ id: idCounter++, lv1: lv1Key, lv1Code: codes.lv1Code, lv2: lv2Key, lv2Code: codes.lv2Code, lv3: '', lv3Code: '' });
                      } else {
                          lv3Array.forEach(lv3Item => {
                              const codes = generateOBSCode(lv1Key, lv2Key, lv3Item);
                              flatRows.push({ id: idCounter++, lv1: lv1Key, lv1Code: codes.lv1Code, lv2: lv2Key, lv2Code: codes.lv2Code, lv3: lv3Item, lv3Code: codes.lv3Code });
                          });
                      }
                  });
              }
          });

          // 고정 키 외 데이터 처리
          Object.keys(initialData).forEach(lv1KeyRaw => {
              const lv1Key = normalizeLv1(lv1KeyRaw);
              if (processedLv1.has(lv1Key)) return;
               const lv2Obj = initialData[lv1Key];
               if (Object.keys(lv2Obj).length === 0) { 
                 const codes = generateOBSCode(lv1Key, '', '');
                 flatRows.push({ id: idCounter++, lv1: lv1Key, lv1Code: codes.lv1Code, lv2: '', lv2Code: '', lv3: '', lv3Code: '' }); 
               }
               else {
                   Object.keys(lv2Obj).forEach(lv2Key => {
                       const lv3Array = lv2Obj[lv2Key];
                       if (lv3Array.length === 0) { 
                         const codes = generateOBSCode(lv1Key, lv2Key, '');
                         flatRows.push({ id: idCounter++, lv1: lv1Key, lv1Code: codes.lv1Code, lv2: lv2Key, lv2Code: codes.lv2Code, lv3: '', lv3Code: '' }); 
                       }
                       else { 
                         lv3Array.forEach(lv3Item => {
                           const codes = generateOBSCode(lv1Key, lv2Key, lv3Item);
                           flatRows.push({ id: idCounter++, lv1: lv1Key, lv1Code: codes.lv1Code, lv2: lv2Key, lv2Code: codes.lv2Code, lv3: lv3Item, lv3Code: codes.lv3Code });
                         });
                       }
                   });
               }
          });
      }
      setRows(flatRows);
  }, [initialData, generateOBSCode]);

  const handleAddRow = () => {
      const newLv1 = FIXED_LV1_OPTIONS[0];
      const newLv2 = teamOptions.length > 0 ? teamOptions[0] : '';
      const newLv3 = workOptions.length > 0 ? workOptions[0] : '';
      const codes = generateOBSCode(newLv1, newLv2, newLv3);
      setRows([...rows, {
          id: Date.now(),
          lv1: newLv1,
          lv1Code: codes.lv1Code,
          lv2: newLv2, 
          lv2Code: codes.lv2Code,
          lv3: newLv3,
          lv3Code: codes.lv3Code
      }]);
  };

  const handleDeleteRow = (id: number) => {
      setRows(rows.filter(row => row.id !== id));
  };

  // 조직 관리에서 설정한 팀 코드 목록 추출 (유효성 검사용)
  const validTeamCodes = useMemo(() => {
    const codes = new Set<string>();
    organization.departments.forEach(dept => {
      dept.teams.forEach(team => {
        const code = (team as any).code || String(dept.teams.indexOf(team) + 1).padStart(2, '0');
        codes.add(code);
      });
    });
    return codes;
  }, [organization]);

  const handleInputChange = (id: number, field: keyof FlatTableRow, value: string) => {
      setRows(rows.map(row => {
          if (row.id !== id) return row;
          
          const updated = { ...row, [field]: value };
          
          // Lv.2 코드 직접 입력 시 조직 관리에서 설정한 팀 코드와 일치하는지 검사
          if (field === 'lv2Code' && value.trim() !== '') {
            const trimmedValue = value.trim();
            if (!validTeamCodes.has(trimmedValue)) {
              alert(`Lv.2 코드 "${trimmedValue}"는 조직 관리에서 설정한 팀 코드와 일치하지 않습니다.\n등록된 팀 코드: ${Array.from(validTeamCodes).sort().join(', ')}`);
              return row; // 변경하지 않고 원래 값 유지
            }
          }
          
          // Lv.1, Lv.2, Lv.3 변경 시 코드 자동 업데이트
          if (field === 'lv1' || field === 'lv2' || field === 'lv3') {
            const codes = generateOBSCode(updated.lv1, updated.lv2, updated.lv3);
            updated.lv1Code = codes.lv1Code;
            updated.lv2Code = codes.lv2Code;
            const preferred = getPreferredLv3CodeFromTaskCatalog(updated.lv2, updated.lv3);
            updated.lv3Code = resolveLv3Code(updated.lv3, updated.lv3Code || preferred) || preferred || '';
          } else if (field === 'lv3Code') {
            // 코드로 입력 시 Lv.3 명칭을 역으로 채움(가능한 경우)
            const hit = findLv3ByCode(value);
            if (hit) {
              updated.lv3 = hit.name;
            }
          }
          
          return updated;
      }));
  };

  const [lv3DropdownRowId, setLv3DropdownRowId] = useState<number | null>(null);
  const [lv3DropdownFilter, setLv3DropdownFilter] = useState('');
  const [lv3ActiveIndex, setLv3ActiveIndex] = useState(0);

  const filteredLv3Entries = useMemo(() => {
    if (!lv3DropdownRowId) return [];
    const q = lv3DropdownFilter.trim().toLowerCase();
    const list = q
      ? lv3Entries.filter(e =>
          e.name.toLowerCase().includes(q) ||
          (e.code || '').toLowerCase().includes(q)
        )
      : lv3Entries;
    return list.slice(0, 80);
  }, [lv3DropdownRowId, lv3DropdownFilter, lv3Entries]);

  useEffect(() => {
    if (lv3DropdownRowId) setLv3ActiveIndex(0);
  }, [lv3DropdownRowId, lv3DropdownFilter]);

  const applyLv3Selection = useCallback((rowId: number, entry: { name: string; code: string }) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const next = { ...r, lv3: entry.name, lv3Code: entry.code };
      // lv1/lv2 코드는 그대로, lv3Code는 선택값으로 고정
      return next;
    }));
    setLv3DropdownRowId(null);
    setLv3DropdownFilter('');
  }, []);

  const sortedRows = useMemo(() => {
    if (!obsSort) return rows;
    const { key, direction } = obsSort;
    const dir = direction === 'asc' ? 1 : -1;
    const norm = (v: any) => String(v ?? '').toLowerCase();
    return [...rows].sort((a, b) => {
      const av = norm((a as any)[key]);
      const bv = norm((b as any)[key]);
      return av.localeCompare(bv, 'ko', { numeric: true }) * dir;
    });
  }, [rows, obsSort]);

  const handleSaveClick = () => {
      const newMaster: CategoryMaster = {};
      FIXED_LV1_OPTIONS.forEach(key => newMaster[key] = {});

      rows.forEach(row => {
          if (!row.lv1 || !row.lv2.trim()) return;
          if (!newMaster[row.lv1]) newMaster[row.lv1] = {};
          if (!newMaster[row.lv1][row.lv2]) newMaster[row.lv1][row.lv2] = [];
          if (row.lv3.trim() && !newMaster[row.lv1][row.lv2].includes(row.lv3)) {
              newMaster[row.lv1][row.lv2].push(row.lv3);
          }
      });
      onSave(newMaster);
  };

  // 템플릿 다운로드 (마스터 데이터 포함)
  const handleDownloadTemplate = () => {
    // ✅ 현재 OBS 화면(저장된 rows)을 템플릿 형식으로 내보내기
    const wsData: any[][] = [[
      'Lv.1 코드', '*Lv1 명칭', 'Lv.2 코드', '*Lv2 명칭', 'Lv.3 코드', '*Lv3 명칭'
    ]];
    rows.forEach(r => {
      // 빈 행도 그대로 내보내되, 선택값이 없는 경우는 공란 유지
      wsData.push([
        r.lv1Code || '',
        r.lv1 || '',
        r.lv2Code || '',
        r.lv2 || '',
        r.lv3Code || '',
        r.lv3 || ''
      ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // ✅ 코드 컬럼 텍스트 고정
    setTextFormatForColumns(ws, [0, 2, 4], { ensureRows: 1000 });
    // ✅ 코드 열(0,2,4) 숨김 처리
    ws['!cols'] = [
      { wch: 10, hidden: true },
      { wch: 25 },
      { wch: 10, hidden: true },
      { wch: 30 },
      { wch: 10, hidden: true },
      { wch: 35 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OBS_Master_Data");
    XLSX.writeFile(wb, `OBS_Master_Data.xlsx`);
  };

  // 엑셀 업로드
  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];

        if (!jsonData || jsonData.length < 2) {
          alert('엑셀 파일에 데이터가 없습니다.');
          return;
        }

        // 헤더 제외하고 데이터 파싱
        const newRows: FlatTableRow[] = [];
        const errors: string[] = [];
        let idCounter = Math.max(...rows.map(r => r.id), 0) + 1;
        let rowIndex = 2; // 헤더 제외하고 시작 (엑셀 행 번호는 2부터)

        jsonData.slice(1).forEach((row: any[]) => {
          // 템플릿 형식: [Lv.1 코드, Lv.1 분류, Lv.2 코드, Lv.2 분류, Lv.3 코드, Lv.3 분류]
          // 기존 형식도 지원: [Lv.1 분류, Lv.2 분류, Lv.3 분류] (하위 호환성)
          let lv1Code = '', lv1 = '', lv2Code = '', lv2 = '', lv3Code = '', lv3 = '';
          
          if (row.length >= 6) {
            // 새 형식 (code 포함)
            lv1Code = row[0]?.toString().trim() || '';
            lv1 = row[1]?.toString().trim() || '';
            lv2Code = row[2]?.toString().trim() || '';
            lv2 = row[3]?.toString().trim() || '';
            lv3Code = row[4]?.toString().trim() || '';
            lv3 = row[5]?.toString().trim() || '';
          } else {
            // 기존 형식 (하위 호환성)
            lv1 = row[0]?.toString().trim() || '';
            lv2 = row[1]?.toString().trim() || '';
            lv3 = row[2]?.toString().trim() || '';
          }

          // ✅ Lv.3(업무 구분3) 유효성 검증: 업무_구분(Lv.3)에 없으면 오류
          const lv3NameV = (lv3 || '').toString().trim();
          if (lv3NameV) {
            const existsInCategory = lv3Entries.some(e => e.name === lv3NameV);
            if (!existsInCategory) {
              errors.push(`행 ${rowIndex}: Lv.3 "${lv3NameV}"가 업무_구분(Lv.3)에 존재하지 않습니다.`);
              rowIndex++;
              return;
            }
          }

          // Lv.1이 유효한 옵션인지 확인
          if (lv1 && FIXED_LV1_OPTIONS.includes(lv1)) {
            // 코드가 없으면 자동 생성
            const codes = generateOBSCode(lv1, lv2, lv3);
            newRows.push({
              id: idCounter++,
              lv1: lv1,
              lv1Code: lv1Code || codes.lv1Code,
              lv2: lv2,
              lv2Code: lv2Code || codes.lv2Code,
              lv3: lv3,
              lv3Code: lv3Code || codes.lv3Code
            });
          } else if (lv1) {
            errors.push(`행 ${rowIndex}: Lv.1 "${lv1}"는 유효한 옵션이 아닙니다. (${FIXED_LV1_OPTIONS.join(', ')} 중 선택)`);
          }
          rowIndex++;
        });

        // 에러가 있으면 에러 모달 표시
        if (errors.length > 0) {
          setUploadErrors(errors);
          setIsErrorModalOpen(true);
        }

        if (newRows.length > 0) {
          setRows([...rows, ...newRows]);
          const successMsg = `${newRows.length}개의 데이터가 추가되었습니다.`;
          if (errors.length > 0) {
            alert(successMsg + '\n\n일부 데이터에서 오류가 발생했습니다. 에러 상세 내용을 확인해주세요.');
          } else {
            alert(successMsg);
          }
        } else {
          if (errors.length > 0) {
            alert('데이터가 추가되지 않았습니다. 에러 상세 내용을 확인해주세요.');
          } else {
            alert('추가할 유효한 데이터가 없습니다.');
          }
        }
      } catch (error: any) {
        setUploadErrors([`엑셀 파일 읽기 오류: ${error.message}`]);
        setIsErrorModalOpen(true);
      }
    };

    reader.onerror = () => {
      alert('파일 읽기 오류가 발생했습니다.');
    };

    // 파일 입력 초기화
    if (e.target) {
      e.target.value = '';
    }
  };

  return (
    <div className="obs-container">
      <div className="obs-header-section admin-toolbar-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div className="obs-title">OBS 관리 (그리드 에디터)</div>
          <div className="obs-desc">
            [Lv.1 과제유형] - [Lv.2 수행팀] - [Lv.3 업무구분]
            <br />
            (Lv.3는 '업무 구분' 탭에 등록된 Lv.3 항목 중에서 선택합니다)
          </div>
        </div>

        {/* 버튼 툴바 (빨간 박스 위치처럼 우측 정렬) */}
        <div className="obs-toolbar admin-toolbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate}>📥 내보내기</button>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
            📤 엑셀 업로드
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              style={{ display: 'none' }}
            />
          </label>
          <button className="btn btn-primary btn-sm" onClick={handleAddRow}>+ 행 추가</button>
          <span className="toolbar-separator"></span>
          <button className="btn btn-success btn-sm" onClick={handleSaveClick}>💾 저장</button>
        </div>
      </div>

      <div className="obs-table-wrapper">
        <table className="obs-table">
          <colgroup>
            {/* 코드 컬럼은 1.5배로 확대 */}
            <col style={{width: '12%'}} />
            <col style={{width: '15%'}} />
            <col style={{width: '12%'}} />
            <col style={{width: '20%'}} />
            <col style={{width: '12%'}} />
            <col style={{width: '21%'}} />
            <col style={{width: '8%'}} />
          </colgroup>
          <thead>
            <tr>
              <th onDoubleClick={() => setObsSort(prev => prev?.key === 'lv1Code' ? ({ key: 'lv1Code', direction: prev.direction === 'asc' ? 'desc' : 'asc' }) : ({ key: 'lv1Code', direction: 'asc' }))}>Lv.1 코드</th>
              <th onDoubleClick={() => setObsSort(prev => prev?.key === 'lv1' ? ({ key: 'lv1', direction: prev.direction === 'asc' ? 'desc' : 'asc' }) : ({ key: 'lv1', direction: 'asc' }))}>Lv.1 분류 (과제 유형)</th>
              <th onDoubleClick={() => setObsSort(prev => prev?.key === 'lv2Code' ? ({ key: 'lv2Code', direction: prev.direction === 'asc' ? 'desc' : 'asc' }) : ({ key: 'lv2Code', direction: 'asc' }))}>Lv.2 코드</th>
              <th onDoubleClick={() => setObsSort(prev => prev?.key === 'lv2' ? ({ key: 'lv2', direction: prev.direction === 'asc' ? 'desc' : 'asc' }) : ({ key: 'lv2', direction: 'asc' }))}>Lv.2 분류 (팀 선택)</th>
              <th onDoubleClick={() => setObsSort(prev => prev?.key === 'lv3Code' ? ({ key: 'lv3Code', direction: prev.direction === 'asc' ? 'desc' : 'asc' }) : ({ key: 'lv3Code', direction: 'asc' }))}>Lv.3 코드</th>
              <th onDoubleClick={() => setObsSort(prev => prev?.key === 'lv3' ? ({ key: 'lv3', direction: prev.direction === 'asc' ? 'desc' : 'asc' }) : ({ key: 'lv3', direction: 'asc' }))}>Lv.3 분류 (업무 구분 선택/입력)</th>
              <th style={{textAlign: 'center'}}>관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
                 <tr><td colSpan={7} className="obs-empty-state">데이터가 없습니다. '행 추가' 버튼을 눌러 등록하세요.</td></tr>
            ) : (
                sortedRows.map((row) => (
                    <tr key={row.id}>
                      {/* Lv.1 Code */}
                      <td>
                        <input 
                          type="text"
                          className="obs-select obs-grid-input"
                          value={row.lv1Code || ''}
                          onChange={(e) => handleInputChange(row.id, 'lv1Code', e.target.value)}
                          style={{ textAlign: 'center', fontSize: '0.9em' }}
                        />
                      </td>
                      {/* Lv.1 Dropdown */}
                      <td>
                        <select 
                            className="obs-select obs-grid-input"
                            value={row.lv1}
                            onChange={(e) => handleInputChange(row.id, 'lv1', e.target.value)}
                        >
                            {FIXED_LV1_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                      </td>
                      {/* Lv.2 Code */}
                      <td>
                        <input 
                          type="text"
                          className="obs-select obs-grid-input"
                          value={row.lv2Code || ''}
                          onChange={(e) => handleInputChange(row.id, 'lv2Code', e.target.value)}
                          style={{ textAlign: 'center', fontSize: '0.9em' }}
                        />
                      </td>
                      {/* Lv.2 Select (팀 선택) */}
                      <td>
                          <select 
                            className="obs-select obs-grid-input" 
                            value={row.lv2}
                            onChange={(e) => handleInputChange(row.id, 'lv2', e.target.value)}
                            style={{ 
                                color: row.lv2 ? '#495057' : '#6c757d', 
                                borderColor: !row.lv2 ? '#ffc107' : '#ced4da',
                                backgroundColor: row.lv2 ? '#fff' : '#fffacd',
                                fontWeight: row.lv2 ? 'normal' : '500'
                            }}
                          >
                            <option value="">(팀 선택)</option>
                            {teamOptions.length > 0 ? (
                                teamOptions.map(teamName => (
                                    <option key={teamName} value={teamName}>{teamName}</option>
                                ))
                            ) : (
                                <option value="" disabled>팀이 없습니다</option>
                            )}
                          </select>
                      </td>
                      {/* Lv.3 Code */}
                      <td>
                        <input 
                          type="text"
                          className="obs-select obs-grid-input"
                          value={row.lv3Code || ''}
                          onChange={(e) => handleInputChange(row.id, 'lv3Code', e.target.value)}
                          style={{ textAlign: 'center', fontSize: '0.9em' }}
                        />
                      </td>
                      {/* [변경] Lv.3 Select (업무 구분 선택) */}
                      <td>
                        <div style={{ position: 'relative' }}>
                          <input
                            type="text"
                            className="obs-select obs-grid-input"
                            value={row.lv3}
                            onChange={(e) => {
                              handleInputChange(row.id, 'lv3', e.target.value);
                              setLv3DropdownRowId(row.id);
                              setLv3DropdownFilter(e.target.value);
                            }}
                            onFocus={() => {
                              setLv3DropdownRowId(row.id);
                              setLv3DropdownFilter(row.lv3 || '');
                            }}
                            onBlur={() => {
                              setTimeout(() => setLv3DropdownRowId(null), 150);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                if (lv3DropdownRowId !== row.id) {
                                  setLv3DropdownRowId(row.id);
                                  setLv3DropdownFilter(row.lv3 || '');
                                  setLv3ActiveIndex(0);
                                  return;
                                }
                                setLv3ActiveIndex((i) => Math.min(i + 1, Math.max(filteredLv3Entries.length - 1, 0)));
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setLv3ActiveIndex((i) => Math.max(i - 1, 0));
                              } else if (e.key === 'Enter') {
                                if (lv3DropdownRowId === row.id && filteredLv3Entries.length > 0) {
                                  e.preventDefault();
                                  const pick = filteredLv3Entries[Math.min(lv3ActiveIndex, filteredLv3Entries.length - 1)];
                                  if (pick) applyLv3Selection(row.id, { name: pick.name, code: pick.code });
                                }
                              } else if (e.key === 'Escape') {
                                setLv3DropdownRowId(null);
                              }
                            }}
                            placeholder="Lv.3 입력 또는 선택"
                            style={{
                              color: row.lv3 ? '#495057' : '#999',
                              borderColor: !row.lv3 ? '#ffc107' : '#ced4da'
                            }}
                          />

                          {lv3DropdownRowId === row.id && filteredLv3Entries.length > 0 && (
                            <div
                              className="custom-dropdown"
                              style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                backgroundColor: '#fff',
                                border: '1px solid #ced4da',
                                borderRadius: '0.375rem',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                maxHeight: '220px',
                                overflowY: 'auto',
                                zIndex: 1000,
                                marginTop: '4px'
                              }}
                              onMouseDown={(e) => e.preventDefault()}
                            >
                              {filteredLv3Entries.map((opt, idx) => {
                                const isActive = idx === lv3ActiveIndex;
                                const label = opt.code ? `${opt.name} (${opt.code})` : opt.name;
                                return (
                                  <div
                                    key={`${opt.name}__${opt.code}__${idx}`}
                                    className="dropdown-option"
                                    style={{
                                      padding: '0.5rem 0.75rem',
                                      cursor: 'pointer',
                                      borderBottom: '1px solid #f0f0f0',
                                      backgroundColor: isActive ? '#e9f2ff' : '#fff'
                                    }}
                                    onMouseEnter={() => setLv3ActiveIndex(idx)}
                                    onClick={() => applyLv3Selection(row.id, { name: opt.name, code: opt.code })}
                                    title={`${opt.cat1} > ${opt.cat2}`}
                                  >
                                    {label}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Delete Button */}
                      <td style={{textAlign: 'center'}}>
                          <button 
                            className="obs-btn-del" 
                            onClick={() => handleDeleteRow(row.id)}
                            title="행 삭제"
                            style={{fontSize: '1.2rem'}}
                          >
                              ×
                          </button>
                      </td>
                    </tr>
                  ))
            )}
          </tbody>
        </table>
      </div>
      <ErrorModal
        isOpen={isErrorModalOpen}
        title="엑셀 업로드 오류"
        errors={uploadErrors}
        onClose={() => setIsErrorModalOpen(false)}
      />
    </div>
  );
};
//1280 --- [수정] CategoryManagementTab: 헤더 제거 및 스타일 래퍼 적용 ---
// 1289 [수정] 테이블 형태의 업무 구분 컴포넌트 (Lv.1, Lv.2만 표시)
//0
//2601071028 1291 [수정] 업무 구분 탭 (모달 적용 + 검정 글씨)
// [수정된 전체 컴포넌트] 업무 구분 탭 (Lv.1 & Lv.2 테이블 + 모달 + 검정 텍스트)
//202601071055
// [수정] 업무 구분 탭
// -----------------------------------------------------------------------------
// [수정] 업무 구분 탭 (Lv.1 ~ Lv.3 전체 관리)
// -----------------------------------------------------------------------------
const CategoryManagementTab = ({ 
  initialData, 
  initialCodes,
  onSave
}: { 
  initialData: CategoryMaster, 
  initialCodes: any,
  onSave: (newMaster: CategoryMaster) => void
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  
  // 상태 관리 (Lv.3 포함하여 초기화)
  const [tree, setTree] = useState<CatNode[]>(() => {
    return Object.keys(initialData).map((cat1Name, idx1) => {
      const cat1Code = initialCodes.category1[cat1Name] || `A${String(idx1 + 1).padStart(2, '0')}`;
      const cat2Obj = initialData[cat1Name];
      
      const children1 = Object.keys(cat2Obj).map((cat2Name, idx2) => {
        const cat2Code = String(idx2 + 1).padStart(2, '0');
        const cat3List = cat2Obj[cat2Name] || [];
        
        // Lv.3 데이터 로드
        const children2 = cat3List.map((cat3Name, idx3) => ({
          id: `c3_${Date.now()}_${Math.random()}_${idx3}`,
          level: 3 as const,
          code: String(idx3 + 1).padStart(2, '0'),
          name: cat3Name,
          children: []
        }));

        return {
          id: `c2_${Date.now()}_${Math.random()}_${idx2}`,
          level: 2 as const,
          code: cat2Code,
          name: cat2Name,
          children: children2
        };
      });

      return {
        id: `c1_${Date.now()}_${Math.random()}_${idx1}`,
        level: 1 as const,
        code: cat1Code,
        name: cat1Name,
        children: children1
      };
    });
  });

  const [deleteTarget, setDeleteTarget] = useState<{id: string, level: number} | null>(null);
  const [isSaveModalOpen, setSaveModalOpen] = useState(false);

  // RowSpan 계산 헬퍼
  const getRowSpan = (node: CatNode): number => {
    if (node.children.length === 0) return 1;
    return node.children.reduce((sum, child) => sum + getRowSpan(child), 0);
  };

  // 다음 코드 자동 생성
  const getNextCode = (siblings: CatNode[], level: 1 | 2 | 3): string => {
    if (siblings.length === 0) return level === 1 ? 'A01' : '01';
    const lastCode = siblings[siblings.length - 1].code;
    const match = lastCode.match(/(\d+)$/);
    if (match) {
      const numStr = match[1];
      const nextNum = parseInt(numStr, 10) + 1;
      const prefix = lastCode.slice(0, -numStr.length);
      return `${prefix}${String(nextNum).padStart(numStr.length, '0')}`;
    }
    return '99';
  };

  const handleAdd = (parentId: string | null, level: 1 | 2 | 3) => {
    if (level === 1) {
      setTree(prev => {
        const nextCode = getNextCode(prev, 1);
        return [...prev, { id: `new_1_${Date.now()}`, level: 1, code: nextCode, name: '', children: [] }];
      });
    } else {
      const addRecursive = (nodes: CatNode[]): CatNode[] => {
        return nodes.map(node => {
          if (node.id === parentId) {
            const nextCode = getNextCode(node.children, level);
            return {
              ...node,
              children: [...node.children, { id: `new_${level}_${Date.now()}`, level: level, code: nextCode, name: '', children: [] }]
            };
          }
          if (node.children.length > 0) {
            return { ...node, children: addRecursive(node.children) };
          }
          return node;
        });
      };
      setTree(prev => addRecursive(prev));
    }
  };

  const handleChange = (id: string, field: 'code' | 'name', value: string) => {
    const updateRecursive = (nodes: CatNode[]): CatNode[] => {
      return nodes.map(node => {
        if (node.id === id) return { ...node, [field]: value };
        if (node.children.length > 0) return { ...node, children: updateRecursive(node.children) };
        return node;
      });
    };
    setTree(prev => updateRecursive(prev));
  };

  const handleDeleteRequest = (id: string, level: number) => {
    setDeleteTarget({ id, level });
  };

  const executeDelete = () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    const deleteRecursive = (nodes: CatNode[]): CatNode[] => {
      return nodes.filter(node => node.id !== id).map(node => ({
        ...node,
        children: deleteRecursive(node.children)
      }));
    };
    setTree(prev => deleteRecursive(prev));
    setDeleteTarget(null);
  };

  const executeSave = () => {
    // 트리 구조 -> 마스터 데이터 변환 (Lv.3 포함)
    const newMasterData: CategoryMaster = {};
    
    tree.forEach(node1 => {
        if (!node1.name) return;
        const lv2Obj: { [key: string]: string[] } = {};
        
        node1.children.forEach(node2 => {
            if (!node2.name) return;
            // Lv.3 배열 생성
            lv2Obj[node2.name] = node2.children
                                    .filter(n3 => n3.name) // 이름 없는 것 제외
                                    .map(n3 => n3.name);
        });
        
        newMasterData[node1.name] = lv2Obj;
    });

    onSave(newMasterData);
    setSaveModalOpen(false);
  };

  const handleDownloadTemplate = () => {
     const wsData = [['Lv1 코드', '*Lv1 명칭', 'Lv2 코드', '*Lv2 명칭', 'Lv3 코드', '*Lv3 명칭']];
     
     // 현재 마스터 데이터를 평탄화하여 엑셀 데이터로 변환
     tree.forEach(node1 => {
       if (!node1.name) return;
       
       node1.children.forEach(node2 => {
         if (!node2.name) return;
         
         // Lv.3가 있는 경우 각각 행으로 추가
         if (node2.children.length > 0) {
           node2.children.forEach(node3 => {
             if (node3.name) {
               wsData.push([
                 node1.code,
                 node1.name,
                 node2.code,
                 node2.name,
                 node3.code,
                 node3.name
               ]);
             }
           });
         } else {
           // Lv.3가 없는 경우 Lv.2만 추가
           wsData.push([
             node1.code,
             node1.name,
             node2.code,
             node2.name,
             '',
             ''
           ]);
         }
       });
     });
     
     const ws = XLSX.utils.aoa_to_sheet(wsData);
     // ✅ 코드 컬럼 텍스트 고정
     setTextFormatForColumns(ws, [0, 2, 4], { ensureRows: 1000 });
     ws['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 20 }];
     const wb = XLSX.utils.book_new();
     XLSX.utils.book_append_sheet(wb, ws, "업무_구분");
     XLSX.writeFile(wb, `Category_Master_Data.xlsx`);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        if (!data) return;

        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];

        if (!jsonData || jsonData.length < 2) {
          alert('엑셀 파일에 데이터가 없습니다.');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // 헤더 제외하고 데이터 파싱
        const uploadData = jsonData.slice(1);
        const newTreeData: CatNode[] = JSON.parse(JSON.stringify(tree)); // 깊은 복사
        
        // 기존 데이터를 맵으로 변환하여 중복 체크용 (명칭 및 코드)
        const existingNameMap = new Map<string, boolean>();
        const existingCodeMap = new Map<string, string>(); // 코드 -> 명칭 매핑
        const errors: string[] = [];
        
        const addToMap = (nodes: CatNode[]) => {
          nodes.forEach(node1 => {
            if (node1.name) {
              existingNameMap.set(`L1_${node1.code}_${node1.name}`, true);
              existingCodeMap.set(`L1_${node1.code}`, node1.name);
              node1.children.forEach(node2 => {
                if (node2.name) {
                  existingNameMap.set(`L2_${node1.code}_${node2.code}_${node2.name}`, true);
                  existingCodeMap.set(`L2_${node1.code}_${node2.code}`, node2.name);
                  node2.children.forEach(node3 => {
                    if (node3.name) {
                      existingNameMap.set(`L3_${node1.code}_${node2.code}_${node3.code}_${node3.name}`, true);
                      existingCodeMap.set(`L3_${node1.code}_${node2.code}_${node3.code}`, node3.name);
                    }
                  });
                }
              });
            }
          });
        };
        addToMap(newTreeData);

        let addedCount = 0;
        let skippedCount = 0;
        let rowIndex = 2; // 헤더 제외하고 시작 (엑셀 행 번호는 2부터)

        // 엑셀 데이터를 순회하며 추가
        uploadData.forEach((row: any[]) => {
          const lv1Code = row[0]?.toString().trim() || '';
          const lv1Name = row[1]?.toString().trim() || '';
          const lv2Code = row[2]?.toString().trim() || '';
          const lv2Name = row[3]?.toString().trim() || '';
          const lv3Code = row[4]?.toString().trim() || '';
          const lv3Name = row[5]?.toString().trim() || '';

          if (!lv1Name) {
            rowIndex++;
            return; // Lv.1 명칭이 없으면 스킵
          }

          // Lv.1 코드 중복 체크
          if (lv1Code) {
            const existingLv1Code = existingCodeMap.get(`L1_${lv1Code}`);
            if (existingLv1Code && existingLv1Code !== lv1Name) {
              errors.push(`행 ${rowIndex}: Lv.1 코드 "${lv1Code}"가 이미 다른 명칭("${existingLv1Code}")으로 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }
          }

          // Lv.1 찾기 또는 생성
          let lv1Node = newTreeData.find(n => n.code === lv1Code && n.name === lv1Name);
          if (!lv1Node) {
            // 코드만 일치하는 경우 체크
            const codeOnlyMatch = newTreeData.find(n => n.code === lv1Code);
            if (codeOnlyMatch) {
              errors.push(`행 ${rowIndex}: Lv.1 코드 "${lv1Code}"가 이미 다른 명칭("${codeOnlyMatch.name}")으로 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }
            
            // 새로운 Lv.1 생성
            const newCode = lv1Code || getNextCode(newTreeData, 1);
            // 새 코드도 중복 체크
            if (existingCodeMap.has(`L1_${newCode}`)) {
              errors.push(`행 ${rowIndex}: Lv.1 코드 "${newCode}"가 이미 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }
            
            lv1Node = {
              id: `new_l1_${Date.now()}_${Math.random()}`,
              level: 1 as const,
              code: newCode,
              name: lv1Name,
              children: []
            };
            newTreeData.push(lv1Node);
            existingCodeMap.set(`L1_${newCode}`, lv1Name);
            existingNameMap.set(`L1_${newCode}_${lv1Name}`, true);
            addedCount++;
          }

          if (!lv2Name) {
            rowIndex++;
            return; // Lv.2 명칭이 없으면 스킵
          }

          // Lv.2 코드 중복 체크
          if (lv2Code) {
            const existingLv2Code = existingCodeMap.get(`L2_${lv1Node.code}_${lv2Code}`);
            if (existingLv2Code && existingLv2Code !== lv2Name) {
              errors.push(`행 ${rowIndex}: Lv.2 코드 "${lv2Code}"가 이미 다른 명칭("${existingLv2Code}")으로 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }
          }

          // Lv.2 찾기 또는 생성
          let lv2Node = lv1Node.children.find(n => n.code === lv2Code && n.name === lv2Name);
          if (!lv2Node) {
            // 코드만 일치하는 경우 체크
            const codeOnlyMatch = lv1Node.children.find(n => n.code === lv2Code);
            if (codeOnlyMatch) {
              errors.push(`행 ${rowIndex}: Lv.2 코드 "${lv2Code}"가 이미 다른 명칭("${codeOnlyMatch.name}")으로 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }
            
            // 새로운 Lv.2 생성
            const newCode = lv2Code || getNextCode(lv1Node.children, 2);
            // 새 코드도 중복 체크
            if (existingCodeMap.has(`L2_${lv1Node.code}_${newCode}`)) {
              errors.push(`행 ${rowIndex}: Lv.2 코드 "${newCode}"가 이미 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }
            
            lv2Node = {
              id: `new_l2_${Date.now()}_${Math.random()}`,
              level: 2 as const,
              code: newCode,
              name: lv2Name,
              children: []
            };
            lv1Node.children.push(lv2Node);
            existingCodeMap.set(`L2_${lv1Node.code}_${newCode}`, lv2Name);
            existingNameMap.set(`L2_${lv1Node.code}_${newCode}_${lv2Name}`, true);
            addedCount++;
          }

          if (lv3Name) {
            // Lv.3 코드 중복 체크
            if (lv3Code) {
              const existingLv3Code = existingCodeMap.get(`L3_${lv1Node.code}_${lv2Node.code}_${lv3Code}`);
              if (existingLv3Code && existingLv3Code !== lv3Name) {
                errors.push(`행 ${rowIndex}: Lv.3 코드 "${lv3Code}"가 이미 다른 명칭("${existingLv3Code}")으로 사용 중입니다.`);
                rowIndex++;
                skippedCount++;
                return;
              }
            }
            
            // Lv.3 중복 체크 (명칭)
            const lv3Key = `L3_${lv1Node.code}_${lv2Node.code}_${lv3Code}_${lv3Name}`;
            if (existingNameMap.has(lv3Key)) {
              rowIndex++;
              skippedCount++;
              return;
            }

            // 코드만 일치하는 경우 체크
            if (lv3Code) {
              const codeOnlyMatch = lv2Node.children.find(n => n.code === lv3Code);
              if (codeOnlyMatch) {
                errors.push(`행 ${rowIndex}: Lv.3 코드 "${lv3Code}"가 이미 다른 명칭("${codeOnlyMatch.name}")으로 사용 중입니다.`);
                rowIndex++;
                skippedCount++;
                return;
              }
            }

            // 새로운 Lv.3 생성
            const newCode = lv3Code || getNextCode(lv2Node.children, 3);
            // 새 코드도 중복 체크
            if (existingCodeMap.has(`L3_${lv1Node.code}_${lv2Node.code}_${newCode}`)) {
              errors.push(`행 ${rowIndex}: Lv.3 코드 "${newCode}"가 이미 사용 중입니다.`);
              rowIndex++;
              skippedCount++;
              return;
            }

            const lv3Node: CatNode = {
              id: `new_l3_${Date.now()}_${Math.random()}`,
              level: 3 as const,
              code: newCode,
              name: lv3Name,
              children: []
            };
            lv2Node.children.push(lv3Node);
            existingCodeMap.set(`L3_${lv1Node.code}_${lv2Node.code}_${newCode}`, lv3Name);
            existingNameMap.set(lv3Key, true);
            addedCount++;
          }
          
          rowIndex++;
        });

        // 에러가 있으면 에러 모달 표시
        if (errors.length > 0) {
          setUploadErrors(errors);
          setIsErrorModalOpen(true);
        }

        if (addedCount > 0) {
          setTree(newTreeData);
          const successMsg = `${addedCount}개의 데이터가 추가되었습니다.${skippedCount > 0 ? ` (${skippedCount}개 중복/오류 제외)` : ''}`;
          if (errors.length > 0) {
            // 에러가 있어도 일부 데이터는 추가되었을 수 있음
            alert(successMsg + '\n\n일부 데이터에서 오류가 발생했습니다. 에러 상세 내용을 확인해주세요.');
          } else {
            alert(successMsg);
          }
        } else {
          if (errors.length > 0) {
            alert('데이터가 추가되지 않았습니다. 에러 상세 내용을 확인해주세요.');
          } else {
            alert('추가할 새로운 데이터가 없습니다. (모두 기존 데이터와 중복)');
          }
        }
      } catch (error: any) {
        setUploadErrors([`엑셀 파일 읽기 오류: ${error.message}`]);
        setIsErrorModalOpen(true);
      }
    };

    reader.onerror = () => {
      alert('파일 읽기 오류가 발생했습니다.');
    };

    // 파일 입력 초기화
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="category-management-container">
      <div className="category-toolbar admin-toolbar-row">
        <div>
          <h3 className="panel-title" style={{ border: 'none', marginBottom: '5px', color: '#333' }}>업무 구분 (Lv.1 /Lv.2/Lv.3)</h3>
          <p className="admin-description" style={{ margin: 0, padding: 0, background: 'none', border: 'none', color: '#666' }}>
            대분류(Lv.1), 중분류(Lv.2), 소분류(Lv.3)를 체계적으로 관리합니다.
          </p>
        </div>
        <div className="admin-toolbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleDownloadTemplate}>📥 내보내기</button>
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', margin: 0 }}>
            📤 엑셀 업로드
            <input
              type="file"
              ref={fileInputRef}
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              style={{ display: 'none' }}
            />
          </label>
          <span className="toolbar-separator"></span>
          <button className="btn btn-primary btn-sm" onClick={() => handleAdd(null, 1)}>+ 대분류 추가</button>
          <span className="toolbar-separator"></span>
          <button className="btn btn-success btn-sm" onClick={() => setSaveModalOpen(true)}>💾 저장</button>
        </div>
      </div>

      <div className="table-container" style={{ marginTop: '20px', backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)', flex: 1 }}>
        <table className="cat-table">
          <thead>
            <tr>
              <th style={{width: '8%', color: '#333'}}>Lv.1 코드</th>
              <th style={{width: '15%', color: '#333'}}>Lv.1 대분류</th>
              <th style={{width: '8%', color: '#333'}}>Lv.2 코드</th>
              <th style={{width: '15%', color: '#333'}}>Lv.2 중분류</th>
              <th style={{width: '8%', color: '#333'}}>Lv.3 코드</th>
              <th style={{width: '20%', color: '#333'}}>Lv.3 소분류</th>
              <th style={{width: '26%', color: '#333'}}>관리</th>
            </tr>
          </thead>
          <tbody>
            {tree.length === 0 ? (
              <tr><td colSpan={8} style={{textAlign:'center', padding:'30px', color:'#999'}}>등록된 분류가 없습니다.</td></tr>
            ) : (
              tree.map((node1) => {
                const n1Span = getRowSpan(node1);
                
                // Lv.1만 있고 하위가 없는 경우
                if (node1.children.length === 0) {
                  return (
                    <tr key={node1.id} className="cat-row">
                       <td className="merged-cell code-cell"><input className="cat-input code-input" value={node1.code} onChange={(e) => handleChange(node1.id, 'code', e.target.value)} /></td>
                       <td className="merged-cell">
                         <input className="cat-input" value={node1.name} onChange={(e) => handleChange(node1.id, 'name', e.target.value)} placeholder="대분류 입력" />
                         <button className="text-btn add" onClick={() => handleAdd(node1.id, 2)}>+ 중분류 추가</button>
                       </td>
                       <td colSpan={5} style={{background:'#f9f9f9', textAlign:'center', color:'#ccc'}}>(중분류 없음)</td>
                       <td>
                          <button className="btn-action delete" onClick={() => handleDeleteRequest(node1.id, 1)} style={{color:'#007bff'}}>🗑️ 대분류 삭제</button>
                       </td>
                    </tr>
                  );
                }

                // Lv.2 순회
                return node1.children.map((node2, idx2) => {
                  const n2Span = getRowSpan(node2);
                  
                  // Lv.2만 있고 하위가 없는 경우
                  if (node2.children.length === 0) {
                    return (
                      <tr key={node2.id} className="cat-row">
                        {idx2 === 0 && <td rowSpan={n1Span} className="merged-cell code-cell"><input className="cat-input code-input" value={node1.code} onChange={(e) => handleChange(node1.id, 'code', e.target.value)} /></td>}
                        {idx2 === 0 && <td rowSpan={n1Span} className="merged-cell">
                           <input className="cat-input" value={node1.name} onChange={(e) => handleChange(node1.id, 'name', e.target.value)} placeholder="대분류 입력" />
                           <button className="text-btn add" onClick={() => handleAdd(node1.id, 2)}>+ 중분류 추가</button>
                        </td>}
                        
                        <td className="code-cell"><input className="cat-input code-input" value={node2.code} onChange={(e) => handleChange(node2.id, 'code', e.target.value)} /></td>
                        <td>
                          <input className="cat-input" value={node2.name} onChange={(e) => handleChange(node2.id, 'name', e.target.value)} placeholder="중분류 입력" />
                          <button className="text-btn add" onClick={() => handleAdd(node2.id, 3)}>+ 소분류 추가</button>
                        </td>
                        <td colSpan={2} style={{background:'#f9f9f9', textAlign:'center', color:'#ccc'}}>(소분류 없음)</td>
                        <td>
                          <button className="btn-action delete" onClick={() => handleDeleteRequest(node2.id, 2)}>🗑️ 중분류 삭제</button>
                          {idx2 === 0 && <div style={{marginTop:'5px', fontSize:'0.8rem'}}><button className="btn-action delete" onClick={() => handleDeleteRequest(node1.id, 1)} style={{color:'#007bff'}}>🚫 대분류 삭제</button></div>}
                        </td>
                      </tr>
                    );
                  }

                  // Lv.3 순회
                  return node2.children.map((node3, idx3) => (
                    <tr key={node3.id} className="cat-row">
                      {idx2 === 0 && idx3 === 0 && <td rowSpan={n1Span} className="merged-cell code-cell"><input className="cat-input code-input" value={node1.code} onChange={(e) => handleChange(node1.id, 'code', e.target.value)} /></td>}
                      {idx2 === 0 && idx3 === 0 && <td rowSpan={n1Span} className="merged-cell">
                         <input className="cat-input" value={node1.name} onChange={(e) => handleChange(node1.id, 'name', e.target.value)} placeholder="대분류 입력" />
                         <button className="text-btn add" onClick={() => handleAdd(node1.id, 2)}>+ 중분류 추가</button>
                      </td>}
                      
                      {idx3 === 0 && <td rowSpan={n2Span} className="code-cell"><input className="cat-input code-input" value={node2.code} onChange={(e) => handleChange(node2.id, 'code', e.target.value)} /></td>}
                      {idx3 === 0 && <td rowSpan={n2Span} style={{verticalAlign:'top'}}>
                         <input className="cat-input" value={node2.name} onChange={(e) => handleChange(node2.id, 'name', e.target.value)} placeholder="중분류 입력" />
                         <button className="text-btn add" onClick={() => handleAdd(node2.id, 3)}>+ 소분류 추가</button>
                      </td>}

                      <td className="code-cell"><input className="cat-input code-input" value={node3.code} onChange={(e) => handleChange(node3.id, 'code', e.target.value)} /></td>
                      <td><input className="cat-input" value={node3.name} onChange={(e) => handleChange(node3.id, 'name', e.target.value)} placeholder="소분류 입력" /></td>
                      <td>
                        <button className="btn-action delete" onClick={() => handleDeleteRequest(node3.id, 3)}>🗑️ 삭제</button>
                        {idx3 === 0 && <div style={{display:'inline-block', marginLeft:'10px'}}><button className="btn-action delete" onClick={() => handleDeleteRequest(node2.id, 2)} style={{color:'#fd7e14', fontSize:'0.8rem'}}>🚫 중분류 삭제</button></div>}
                      </td>
                    </tr>
                  ));
                });
              })
            )}
          </tbody>
        </table>
      </div>

      <SimpleConfirmModal 
        isOpen={!!deleteTarget}
        title="삭제 확인"
        message={deleteTarget?.level === 1 ? "대분류를 삭제하시겠습니까?\n하위 모든 분류가 삭제됩니다." : deleteTarget?.level === 2 ? "중분류를 삭제하시겠습니까?\n하위 소분류가 모두 삭제됩니다." : "소분류를 삭제하시겠습니까?"}
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <SimpleConfirmModal 
        isOpen={isSaveModalOpen}
        title="저장 확인"
        message="변경 사항을 저장하시겠습니까?"
        onConfirm={executeSave}
        onCancel={() => setSaveModalOpen(false)}
      />
      <ErrorModal
        isOpen={isErrorModalOpen}
        title="엑셀 업로드 오류"
        errors={uploadErrors}
        onClose={() => setIsErrorModalOpen(false)}
      />
    </div>
  );
};
//202601071055 
//2601071130
// [수정] AdminPanel: 최신 데이터를 CategoryManagementTab에 전달하도록 수정
// -----------------------------------------------------------------------------
// [수정] AdminPanel: 4개의 탭으로 구성 (OBS 관리 추가)
// -----------------------------------------------------------------------------
const AdminPanel = ({ 
  data, 
  onUpdateData, 
  addNotification 
}: { 
  data: SampleData, 
  onUpdateData: (data: SampleData) => void, 
  addNotification: (message: string, type?: 'success' | 'error') => void 
}) => {
  // 탭 상태: 'org' | 'user' | 'category' | 'obs'
  const [currentTab, setCurrentTab] = useState('org');
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; level: string; ids: any } | null>(null);
  const { organization, tasks } = data;

  // 최신 카테고리 마스터 데이터 가져오기 (업무 구분용)
  const activeCategoryData = useMemo(() => {
    const firstDept = organization.departments[0];
    if (firstDept && firstDept.teams.length > 0) {
      return firstDept.teams[0].categoryMaster;
    }
    return categoryMasterData;
  }, [organization]);

  // 최신 OBS 마스터 데이터 가져오기 (OBS 관리용)
  const activeOBSData = useMemo(() => {
    const firstDept = organization.departments[0];
    if (firstDept && firstDept.teams.length > 0) {
      return firstDept.teams[0].obsMaster || {};
    }
    return {};
  }, [organization]);

  // --- 기존 조직 관리 함수들 ---
  const handleAddOrg = (level: 'department' | 'team' | 'group', name: string, parentIds?: { departmentId?: string; teamId?: string }) => {
    if (!name) return;
    let newOrganization = JSON.parse(JSON.stringify(organization));
    const newId = `${level}_${Date.now()}`;
    if (level === 'department') { newOrganization.departments.push({ id: newId, name, teams: [] }); }
    else if (level === 'team' && parentIds?.departmentId) { const dept = newOrganization.departments.find((d: Department) => d.id === parentIds.departmentId); if (dept) { dept.teams.push({ id: newId, name, groups: [], categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)) }); } }
    else if (level === 'group' && parentIds?.teamId) { let found = false; for (const dept of newOrganization.departments) { const team = dept.teams.find((t: Team) => t.id === parentIds.teamId); if (team) { team.groups.push({ id: newId, name, members: [] }); found = true; break; } } if (!found) { addNotification("상위 팀을 찾지 못해 실패했습니다.", "error"); return; } }
    onUpdateData({ ...data, organization: newOrganization });
    addNotification(`'${name}' 추가됨`, 'success');
  };

  const requestDelete = (level: string, ids: any) => { setDeleteConfirm({ isOpen: true, level, ids }); };

  const executeDelete = () => {
    if (!deleteConfirm) return;
    const { level, ids } = deleteConfirm;
    setDeleteConfirm(null); 
    try {
      const newOrganization = JSON.parse(JSON.stringify(organization));
      let newTasks = [...tasks];
      let targetName = '';
      let isDeleted = false;
      if (level === 'group' && ids.groupId) { outerLoop: for (const dept of newOrganization.departments) { if (!dept.teams) continue; for (const team of dept.teams) { if (!team.groups) continue; const idx = team.groups.findIndex((g: any) => g.id === ids.groupId); if (idx > -1) { targetName = team.groups[idx].name; team.groups.splice(idx, 1); newTasks = newTasks.filter(t => t.group !== targetName); isDeleted = true; break outerLoop; } } } }
      else if (level === 'team' && ids.teamId) { for (const dept of newOrganization.departments) { if (!dept.teams) continue; const idx = dept.teams.findIndex((t: any) => t.id === ids.teamId); if (idx > -1) { targetName = dept.teams[idx].name; const relatedGroups = dept.teams[idx].groups?.map((g: any) => g.name) || []; dept.teams.splice(idx, 1); newTasks = newTasks.filter(t => t.team !== targetName && !relatedGroups.includes(t.group)); isDeleted = true; break; } } }
      else if (level === 'department' && ids.departmentId) { const idx = newOrganization.departments.findIndex((d: any) => d.id === ids.departmentId); if (idx > -1) { targetName = newOrganization.departments[idx].name; const dept = newOrganization.departments[idx]; const relatedTeams = dept.teams?.map((t: any) => t.name) || []; const relatedGroups = dept.teams?.flatMap((t: any) => t.groups?.map((g: any) => g.name) || []) || []; newOrganization.departments.splice(idx, 1); newTasks = newTasks.filter(t => t.department !== targetName && !relatedTeams.includes(t.team) && !relatedGroups.includes(t.group)); isDeleted = true; } }
      if (isDeleted) { onUpdateData({ organization: newOrganization, tasks: newTasks }); addNotification(`'${targetName}' 삭제 완료`, 'success'); } else { addNotification(`삭제할 대상을 찾지 못했습니다.`, 'error'); }
    } catch (e: any) { console.error(e); addNotification(`삭제 중 오류 발생: ${e.message}`, 'error'); }
  };

  // 업무 구분 데이터 저장 핸들러
  const handleCategorySave = (newMasterData: CategoryMaster) => {
    const newOrganization = JSON.parse(JSON.stringify(organization));
    const teamMapping = (window as any).categoryTeamMapping || {};
    
    newOrganization.departments.forEach((dept: Department) => {
        dept.teams.forEach((team: Team) => {
            team.categoryMaster = newMasterData;
            // 팀 매핑 정보 저장 (Team 타입에 teamMapping 필드가 있다고 가정)
            (team as any).categoryTeamMapping = teamMapping;
        });
    });
    onUpdateData({ ...data, organization: newOrganization });
    addNotification("업무 구분 정보가 저장되었습니다.", "success");
  };

  // OBS 관리 데이터 저장 핸들러 (업무 구분과 분리)
  const handleOBSSave = (newOBSData: CategoryMaster) => {
    const newOrganization = JSON.parse(JSON.stringify(organization));
    
    newOrganization.departments.forEach((dept: Department) => {
        dept.teams.forEach((team: Team) => {
            team.obsMaster = newOBSData;
        });
    });
    onUpdateData({ ...data, organization: newOrganization });
    addNotification("OBS 관리 정보가 저장되었습니다.", "success");
  };

  // Task 목록 기반으로 OBS 마스터 자동 생성 및 적용
  const handleGenerateOBSFromTasks = useCallback(() => {
    const FIXED_LV1_OPTIONS = ["1. 중점과제", "2. 지시과제", "3. 자체과제", "4. 현장지원", "5. 기타"];
    const obsMaster: CategoryMaster = {};
    
    // 고정 Lv.1 옵션 초기화
    FIXED_LV1_OPTIONS.forEach(lv1 => {
      obsMaster[lv1] = {};
    });

    // Task 목록을 순회하며 팀별, category3별로 OBS 마스터 구성
    // 기본적으로 "3. 자체과제"에 매핑 (과제유형 정보가 없으므로)
    const defaultLv1 = "3. 자체과제";
    
    tasks.forEach(task => {
      if (!task.team || !task.category3) return;
      
      const teamName = task.team;
      const category3 = task.category3;
      
      // 기본 Lv.1에 팀별로 그룹화
      if (!obsMaster[defaultLv1][teamName]) {
        obsMaster[defaultLv1][teamName] = [];
      }
      
      // 중복 제거하며 추가
      if (!obsMaster[defaultLv1][teamName].includes(category3)) {
        obsMaster[defaultLv1][teamName].push(category3);
      }
    });

    // 모든 팀에 대해 정렬
    Object.keys(obsMaster).forEach(lv1 => {
      Object.keys(obsMaster[lv1]).forEach(team => {
        obsMaster[lv1][team].sort();
      });
    });

    // 생성된 OBS 마스터 저장
    handleOBSSave(obsMaster);
    addNotification(`Task 목록 기반으로 OBS 마스터가 생성되었습니다. (${tasks.length}개 Task 분석)`, "success");
  }, [tasks, handleOBSSave, addNotification]);
  //2601071130

  //2601071130
  // --- (조직 관리 로직 끝) ---

 

  return (
    <div className="admin-panel">
      <div className="admin-tabs">
        <button className={`admin-tab ${currentTab === 'org' ? 'active' : ''}`} onClick={() => setCurrentTab('org')}>🏢 조직 관리</button>
        <button className={`admin-tab ${currentTab === 'user' ? 'active' : ''}`} onClick={() => setCurrentTab('user')}>👤 사용자 관리</button>
        <button className={`admin-tab ${currentTab === 'category' ? 'active' : ''}`} onClick={() => setCurrentTab('category')}>📚 업무 구분</button>
        {/* [NEW] OBS 관리 탭 추가 */}
        <button className={`admin-tab ${currentTab === 'obs' ? 'active' : ''}`} onClick={() => setCurrentTab('obs')}>⚙️ OBS 관리</button>
      </div>

      <div className="admin-content" style={{ backgroundColor: '#f4f6f9', padding: '20px' }}>
        {currentTab === 'org' && <OrgManagementTab organization={organization} onAdd={handleAddOrg} onDelete={requestDelete} onUpdateOrg={(newOrg) => onUpdateData({...data, organization: newOrg})} />}
        
        {currentTab === 'user' && <UserManagementTab organization={organization} onUpdateOrg={(newOrg) => onUpdateData({...data, organization: newOrg})} />}
        
        {/* 기존 업무 구분 탭 (트리 형태) */}
        {currentTab === 'category' && (
          <CategoryManagementTab 
            initialData={activeCategoryData} 
            initialCodes={categoryCodeMapping} 
            onSave={handleCategorySave}
          />
        )}
 

        {/* [NEW] 신규 OBS 관리 탭 */}
        {currentTab === 'obs' && (
          <div>
            <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#fff', borderRadius: '4px', border: '1px solid #ddd' }}>
              <button 
                className="btn btn-info btn-sm" 
                onClick={handleGenerateOBSFromTasks}
                style={{ marginRight: '10px' }}
              >
                🔄 Task 목록에서 OBS 마스터 자동 생성
              </button>
              <span style={{ fontSize: '0.9rem', color: '#666' }}>
                현재 Task 목록({tasks.length}개)을 분석하여 OBS 마스터를 자동으로 생성합니다.
              </span>
            </div>
            <OBSManagementTab 
              initialData={activeOBSData} 
              onSave={handleOBSSave}
              organization={organization}
            />
          </div>
        )}
      </div>

      {deleteConfirm && <ConfirmModal isOpen={deleteConfirm.isOpen} message={`정말로 '${deleteConfirm.level}'을(를) 삭제하시겠습니까?\n관련된 하위 조직과 모든 Task가 삭제됩니다.`} onConfirm={executeDelete} onCancel={() => setDeleteConfirm(null)} />}
    </div>
  );
};

//2601071130

const getTaskPropertyValue = (task: Task, key: SortKey) => {
  switch (key) {
    case 'taskCode': return task.taskCode;
    // 하위 호환: 기존 'category'는 category1로 유지
    case 'category': return task.category1;
    // 컬럼별 독립 정렬용
    case 'category1': return task.category1;
    case 'category2': return task.category2;
    case 'category3': return task.category3;
    case 'name': return task.name;
    case 'assigneeName': return task.assigneeName;
    case 'affiliation': return task.team;
    case 'planned': return getCurrentPlan(task).startDate;
    case 'actual': return task.actual.startDate;
    case 'status': return task.status;
    // 비활성화 정렬: 활성 Task가 먼저 오도록 (active: 0, inactive: 1)
    case 'active': return task.isActive !== false ? 0 : 1;
    // 이슈 관리 정렬: "미확인(미검토) 이슈 개수" 기준
    case 'issues': return task.monthlyIssues?.filter(i => !i.reviewed).length || 0;
    // 등록구분 정렬:
    // - Task 등록(수동 입력): 항상 '추가'로 간주 (뒤로 정렬)
    // - admin 생성(R.n): n(이력 개수)로 정렬
    // - admin 외(추가): 항상 뒤로(큰 값)
    case 'registration': {
      const parsed = parseRegistration(task.registration);
      if (parsed) return (parsed.prefix === 'R' ? 0 : 5000) + parsed.n;
      const createdVia = task.createdVia ?? 'unknown';
      if (createdVia === 'manual') return 10000;
      const createdByRole = task.createdByRole ?? 'admin';
      if (createdByRole !== 'admin') return 10000;
      return task.revisions?.length ?? 0;
    }
    default: return '';
  }
};

const UploadModal = ({ isOpen, onClose, type, onUpload }: { isOpen: boolean; onClose: () => void; type: 'full' | 'hours' | null; onUpload: (file: File) => void }) => {
  const [file, setFile] = useState<File | null>(null);
  if (!isOpen) return null;
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files && e.target.files[0]) setFile(e.target.files[0]); };
  return (<div className="modal show" onClick={(e) => e.target === e.currentTarget && onClose()}> <div className="modal-content"> <div className="modal-header"> <h3>{type === 'hours' ? '시수 데이터 업로드' : 'Task 일괄 업로드'}</h3> <button className="modal-close-btn" onClick={onClose}>×</button> </div> <div className="modal-body"> <p style={{ marginBottom: '1rem', color: '#666' }}> {type === 'hours' ? '월별 실적 시수가 포함된 엑셀 파일을 업로드해주세요.' : '새로운 Task 목록이 담긴 엑셀 파일을 업로드해주세요.'} </p> <div className="upload-area" onClick={() => document.getElementById('fileInput')?.click()}> <input type="file" id="fileInput" hidden onChange={handleFileChange} accept=".xlsx, .xls" /> <span style={{ fontSize: '2rem' }}>📂</span> <p>{file ? file.name : '클릭하여 파일 선택'}</p> </div> </div> <div className="modal-footer"> <button className="btn btn-secondary" onClick={onClose}>취소</button> <button className="btn btn-primary" disabled={!file} onClick={() => file && onUpload(file)}>업로드</button> </div> </div> </div>);
};
//2601071138
// [수정] EditModal 컴포넌트 내부
//2601081207
// [수정] EditModal: 안전한 데이터 접근 로직 적용
const EditModal = ({
  isOpen,
  onClose,
  task,
  onSave,
  onOpenRevisionModal,
  onUpdateCategoryMaster,
  onNotification,
  currentUser
}: {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  onSave: (task: Task) => void;
  onOpenRevisionModal?: (task: Task) => void;
  onUpdateCategoryMaster?: (category1: string, category2: string, category3: string) => void;
  onNotification?: (message: string, type: 'success' | 'error') => void;
  currentUser?: UserContextType;
}) => {
  const [editedTask, setEditedTask] = useState<Task | null>(null);
  const [revisedStart, setRevisedStart] = useState('');
  const [revisedEnd, setRevisedEnd] = useState('');
  const [revisedDailyHours, setRevisedDailyHours] = useState('');
  const [revisedPlannedHours, setRevisedPlannedHours] = useState('');
  const [plannedHoursManuallyEdited, setPlannedHoursManuallyEdited] = useState(false);
  const [cat2Options, setCat2Options] = useState<string[]>([]);
  const [cat3Options, setCat3Options] = useState<string[]>([]);
  const [showCategory3Dropdown, setShowCategory3Dropdown] = useState(false);
  const [category3Filter, setCategory3Filter] = useState('');
  const [category3ActiveIndex, setCategory3ActiveIndex] = useState(0);

  // 변경 종료일 - 변경 착수일 기반(달력일) 계산: (end-start)+1 (같은 날이면 1일)
  const getCalendarDaysInclusive = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff + 1 : 0;
  };

  // 유연한 시수 입력 정규화
  const normalizeFlexibleHHMMInput = (raw: string): string | null => {
    const s = (raw ?? '').trim();
    if (!s) return null;
    if (!/^\d+(\.\d*)?$/.test(s)) return null;
    const [hStr, mRaw] = s.split('.');
    const h = parseInt(hStr, 10);
    if (Number.isNaN(h) || h < 0) return null;
    if (mRaw === undefined || mRaw.length === 0) return `${h}.00`;
    const head2 = mRaw.padEnd(2, '0').slice(0, 2);
    let m = parseInt(head2, 10);
    if (Number.isNaN(m)) return null;
    // 0.01 이하 값 올림 포함: 소수점 2자리 초과에 유효 숫자가 있으면 +1분
    const rest = mRaw.slice(2);
    const shouldCeil = rest.length > 0 && /[1-9]/.test(rest);
    if (shouldCeil) m += 1;
    if (m < 0 || m > 60) return null;
    return `${h}.${String(m).padStart(2, '0')}`;
  };

  const lastValidDailyRef = useRef<string>('0.00');
  const lastValidPlannedRef = useRef<string>('0.00');
  const savedScrollPositionRef = useRef<number>(0);

  // 모달 열릴 때 스크롤 위치 저장, 닫힐 때 복원
  useEffect(() => {
    if (isOpen) {
      // 모달이 열릴 때 현재 스크롤 위치 저장
      savedScrollPositionRef.current = window.scrollY || document.documentElement.scrollTop || 0;
      // 모달이 열려있는 동안 body 스크롤 방지 (모달 내부 스크롤은 허용)
      document.body.style.overflow = 'hidden';
    } else {
      // 모달이 닫힐 때 저장된 스크롤 위치로 복원
      document.body.style.overflow = '';
      // 다음 프레임에서 스크롤 복원 (모달 애니메이션 완료 후)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (savedScrollPositionRef.current > 0) {
            window.scrollTo(0, savedScrollPositionRef.current);
            savedScrollPositionRef.current = 0;
          }
        });
      });
    }
  }, [isOpen]);

  // ESC로 모달 닫기 (클릭 외부 이탈 방지와 별개)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (task) {
      setEditedTask(task);
      setRevisedStart(task.planned.startDate || '');
      setRevisedEnd(task.planned.endDate || '');
      // 기본값: 현재 계획 시수/하루 예상 시수
      const initDays = getCalendarDaysInclusive(task.planned.startDate || '', task.planned.endDate || '');
      const initDailyRaw = initDays > 0 ? normalizeHHMM(numberToHHMM(hhmmToNumber(task.planned.hours) / initDays)) : '00.00';
      const initDaily = normalizeFlexibleHHMMInput(initDailyRaw) || initDailyRaw;
      setRevisedDailyHours(initDaily);
      setRevisedPlannedHours(normalizeFlexibleHHMMInput(task.planned.hours || '00.00') || (task.planned.hours || '00.00'));
      setPlannedHoursManuallyEdited(false);
      lastValidDailyRef.current = initDaily;
      lastValidPlannedRef.current = normalizeFlexibleHHMMInput(task.planned.hours || '00.00') || (task.planned.hours || '00.00');
      setCategory3Filter('');
      setShowCategory3Dropdown(false);
      
      // [안전장치 추가] categoryMasterData 접근 시 undefined 체크
      const cat1Data = categoryMasterData[task.category1] || {};
      if (task.category1) { 
        setCat2Options(Object.keys(cat1Data)); 
      }
      if (task.category1 && task.category2) { 
        // cat1Data가 빈 객체일 경우 cat1Data[task.category2] 접근 시 에러 없음 (undefined 반환)
        setCat3Options(cat1Data[task.category2] || []); 
      }
    }
  }, [task, isOpen]);

  // 날짜(변경 착수일/종료일)가 바뀌면, 하루 예상 변경 시수가 유효한 경우 변경 시수를 "기간 * 하루예상"으로 자동 재계산
  // 단, 사용자가 '변경 시수'를 직접 Key-in으로 수정한 경우에는 자동 덮어쓰지 않음
  useEffect(() => {
    if (!isOpen || !editedTask) return;
    if (plannedHoursManuallyEdited) return;
    const normalizedDaily = normalizeFlexibleHHMMInput(revisedDailyHours);
    if (!normalizedDaily) return;
    const days = getCalendarDaysInclusive(
      revisedStart || editedTask.planned.startDate || '',
      revisedEnd || editedTask.planned.endDate || ''
    );
    const total = days > 0 ? hhmmToNumber(normalizedDaily) * days : 0;
    const nextPlanned = normalizeFlexibleHHMMInput(normalizeHHMM(numberToHHMM(total))) || normalizeHHMM(numberToHHMM(total));
    if (nextPlanned !== revisedPlannedHours) setRevisedPlannedHours(nextPlanned);
  }, [isOpen, editedTask, revisedStart, revisedEnd, revisedDailyHours, plannedHoursManuallyEdited, revisedPlannedHours]);

  // 선택된 업무구분 1, 2에 해당하는 Lv.3 소분류 목록 (드롭다운용)
  const allCategory3Options = useMemo(() => {
    if (!editedTask?.category1 || !editedTask?.category2) {
      return [];
    }
    const cat1Data = categoryMasterData[editedTask.category1] || {};
    return (cat1Data[editedTask.category2] || []).sort();
  }, [editedTask?.category1, editedTask?.category2]);

  // 필터링된 Lv.3 옵션 (입력 텍스트 기반)
  const filteredCategory3Options = useMemo(() => {
    if (!category3Filter) return allCategory3Options;
    return allCategory3Options.filter(opt => 
      opt.toLowerCase().includes(category3Filter.toLowerCase())
    );
  }, [allCategory3Options, category3Filter]);

  useEffect(() => {
    if (showCategory3Dropdown) setCategory3ActiveIndex(0);
  }, [showCategory3Dropdown, category3Filter]);

  if (!isOpen || !editedTask) return null;

  const handleChange = (field: string, value: any) => {
    setEditedTask(prev => {
      if (!prev) return null;
      const updated = { ...prev, [field]: value };
      
      if (field === 'category1') { 
        updated.category2 = ''; 
        updated.category3 = ''; 
        // [안전장치]
        const cat1Data = categoryMasterData[value] || {};
        setCat2Options(Object.keys(cat1Data)); 
        setCat3Options([]); 
      }
      else if (field === 'category2') { 
        updated.category3 = ''; 
        setCategory3Filter('');
        setShowCategory3Dropdown(false);
        // [안전장치]
        const cat1Data = categoryMasterData[updated.category1] || {};
        setCat3Options(cat1Data[value] || []); 
      }
      return updated;
    });
  };

  const statusLabelMap: Record<string, string> = { 'not-started': '미시작', 'in-progress': '진행중', 'delayed': '지연', 'completed': '완료' };
  
  const handleSave = () => {
    if (!editedTask || !task) return;
    let finalTask = { ...editedTask };
    let changeLog: string[] = [];
    
    // 변경 이력 로그 생성
    if (editedTask.status !== task.status) { const oldLabel = statusLabelMap[task.status] || task.status; const newLabel = statusLabelMap[editedTask.status] || editedTask.status; changeLog.push(`상태: ${oldLabel} → ${newLabel}`); }
    if (editedTask.category1 !== task.category1) changeLog.push(`카테고리1: ${task.category1} → ${editedTask.category1}`);
    if (editedTask.category2 !== task.category2) changeLog.push(`카테고리2: ${task.category2} → ${editedTask.category2}`);
    if (editedTask.category3 !== task.category3) changeLog.push(`카테고리3: ${task.category3} → ${editedTask.category3}`);
    if (editedTask.name !== task.name) changeLog.push(`Task명 변경: ${task.name} → ${editedTask.name}`);
    
    const originalStart = task.planned.startDate || '';
    const originalEnd = task.planned.endDate || '';
    if (revisedStart !== originalStart) { finalTask.planned.startDate = revisedStart; changeLog.push(`착수일: ${originalStart} → ${revisedStart}`); }
    if (revisedEnd !== originalEnd) { finalTask.planned.endDate = revisedEnd; changeLog.push(`종료일: ${originalEnd} → ${revisedEnd}`); }

    // 계획 시수 변경 (하루 예상 변경 시수 / 변경 시수)
    const normalizedPlanned = normalizeFlexibleHHMMInput(revisedPlannedHours) || finalTask.planned.hours;
    const oldPlannedStr = normalizeFlexibleHHMMInput(task.planned.hours) || task.planned.hours;
    const oldPlannedNum = hhmmToNumber(oldPlannedStr);
    const newPlannedNum = hhmmToNumber(normalizedPlanned);
    if (Math.abs(newPlannedNum - oldPlannedNum) > 1e-9) {
      finalTask.planned.hours = normalizedPlanned;
      changeLog.push(`계획 시수(이전): ${oldPlannedStr} → ${normalizedPlanned}`);
    }

    // 하루 예상 시수는 Task에 저장되는 값은 아니지만 변경 내역으로는 남김
    const originalDays = getCalendarDaysInclusive(task.planned.startDate || '', task.planned.endDate || '');
    const originalDailyRaw = originalDays > 0 ? normalizeHHMM(numberToHHMM(hhmmToNumber(task.planned.hours) / originalDays)) : '00.00';
    const originalDaily = normalizeFlexibleHHMMInput(originalDailyRaw) || originalDailyRaw;
    const normalizedDaily = normalizeFlexibleHHMMInput(revisedDailyHours) || originalDaily;
    if (normalizedDaily !== originalDaily) {
      changeLog.push(`하루 예상 시수: ${originalDaily} → ${normalizedDaily}`);
    }
    
    if (changeLog.length > 0) { 
      const today = new Date(); 
      const kstOffset = 9 * 60 * 60 * 1000; 
      const todayStr = new Date(today.getTime() + kstOffset).toISOString().split('T')[0]; 
      const autoIssue: Issue = { date: todayStr, issue: `[정보 변경] ${changeLog.join(', ')}`, author: currentUser?.name || '시스템', reviewed: false, replies: [] }; 
      finalTask.monthlyIssues = [...(finalTask.monthlyIssues || []), autoIssue]; 
    }
    onSave(finalTask);
  };

  const calendarDays = getCalendarDaysInclusive(editedTask.planned.startDate || '', editedTask.planned.endDate || '');
  const dailyHoursRaw = calendarDays > 0 ? normalizeHHMM(numberToHHMM(hhmmToNumber(editedTask.planned.hours) / calendarDays)) : '00.00';
  const dailyHours = normalizeFlexibleHHMMInput(dailyHoursRaw) || dailyHoursRaw;
  const getStatusColor = (status: string) => { switch(status) { case 'completed': return '#d4edda'; case 'in-progress': return '#cce5ff'; case 'delayed': return '#fff3cd'; default: return '#e2e3e5'; } };

// ... (EditModal 컴포넌트 내부)

  return (
    // [중요] 모달 바깥 클릭 시 닫힘/클릭-스루 방지
    <div
      className="modal show"
      style={{ zIndex: 10000 }}
      onMouseDown={(e) => {
        // 배경으로 이벤트가 전달되어 모달이 닫히는 현상 방지
        e.stopPropagation();
      }}
    >
      <div
        className="modal-content"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Task 수정</h3>
        </div>
        <div className="modal-body">
          {/* Task Code: 담당자(팀원) 화면에서는 숨김 */}
          {currentUser?.role !== 'member' && (
            <div className="form-group">
              <label className="form-label">Task Code</label>
              <input className="form-input" value={formatTaskCode(editedTask.taskCode)} readOnly />
            </div>
          )}
          {/* [삭제됨] 담당자 표시 블록 제거 */}
          {/* <div className="form-group"><label className="form-label">담당자</label><input ... /></div> */}
          
          {/* 업무 구분 1(넓게) + 업무 구분 2(우측) */}
          <div className="form-row">
            <div className="form-group" style={{ flex: 1.6 }}>
              <label className="form-label">업무 구분 1</label>
              <select className="form-input" value={editedTask.category1} onChange={e => handleChange('category1', e.target.value)}>
                <option value="">선택하세요</option>
                {Object.keys(categoryMasterData).map(cat => (<option key={cat} value={cat}>{cat}</option>))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">업무 구분 2</label>
              <select className="form-input" value={editedTask.category2} onChange={e => handleChange('category2', e.target.value)} disabled={!editedTask.category1}>
                <option value="">선택하세요</option>
                {cat2Options.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
          </div>

          {/* Task 1: (기존 업무 구분3) 위치를 아래로 이동 + 넓게 */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">Task 1</label>
            <input 
              type="text" 
              className="form-input" 
              value={editedTask.category3} 
              onChange={e => {
                handleChange('category3', e.target.value);
                setCategory3Filter(e.target.value);
                setShowCategory3Dropdown(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (!showCategory3Dropdown) {
                    setShowCategory3Dropdown(true);
                    setCategory3ActiveIndex(0);
                    return;
                  }
                  setCategory3ActiveIndex(i => Math.min(i + 1, Math.max(filteredCategory3Options.length - 1, 0)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCategory3ActiveIndex(i => Math.max(i - 1, 0));
                } else if (e.key === 'Enter') {
                  if (showCategory3Dropdown && editedTask.category2 && filteredCategory3Options.length > 0) {
                    e.preventDefault();
                    const pick = filteredCategory3Options[Math.min(category3ActiveIndex, filteredCategory3Options.length - 1)];
                    if (pick) handleChange('category3', pick);
                    setCategory3Filter('');
                    setShowCategory3Dropdown(false);
                  }
                }
              }}
              onFocus={() => {
                if (editedTask.category2) {
                  setShowCategory3Dropdown(true);
                  setCategory3Filter(editedTask.category3);
                }
              }}
              onBlur={() => {
                // 드롭다운 클릭 시에는 닫히지 않도록 약간의 지연
                setTimeout(() => setShowCategory3Dropdown(false), 200);
              }}
              placeholder={editedTask.category2 ? "선택하거나 직접 입력" : "상위 항목 선택 필요"}
              disabled={!editedTask.category2}
            />
            {/* 커스텀 드롭다운 리스트 */}
            {showCategory3Dropdown && editedTask.category2 && filteredCategory3Options.length > 0 && (
              <div 
                className="custom-dropdown"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#fff',
                  border: '1px solid #ced4da',
                  borderRadius: '0.375rem',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  marginTop: '4px'
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {filteredCategory3Options.map((opt, idx) => (
                  <div
                    key={opt}
                    className="dropdown-option"
                    style={{
                      padding: '0.5rem 0.75rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f0f0f0',
                      backgroundColor: idx === category3ActiveIndex ? '#e9f2ff' : '#fff'
                    }}
                    onMouseEnter={(e) => {
                      setCategory3ActiveIndex(idx);
                      e.currentTarget.style.backgroundColor = '#f8f9fa';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#fff';
                    }}
                    onClick={() => {
                      handleChange('category3', opt);
                      setCategory3Filter('');
                      setShowCategory3Dropdown(false);
                    }}
                  >
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group"><label className="form-label">Task 2</label><input type="text" className="form-input" value={editedTask.name} onChange={e => handleChange('name', e.target.value)} /></div>
          
          <div className="form-row"><div className="form-group"><label className="form-label">현재 계획 착수일</label><input type="date" className="form-input" value={editedTask.planned.startDate || ''} disabled style={{ backgroundColor: '#e9ecef', color: '#6c757d' }} /></div><div className="form-group"><label className="form-label">현재 계획 종료일</label><input type="date" className="form-input" value={editedTask.planned.endDate || ''} disabled style={{ backgroundColor: '#e9ecef', color: '#6c757d' }} /></div></div>
          <div className="form-row"><div className="form-group"><label className="form-label">하루 예상 시수</label><input type="text" className="form-input" value={dailyHours} disabled style={{ backgroundColor: '#e9ecef' }} /></div><div className="form-group"><label className="form-label">계획 시수</label><input type="text" className="form-input" value={editedTask.planned.hours} disabled style={{ backgroundColor: '#e9ecef' }} /></div></div>
          
          <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#343a40', display: 'flex', alignItems: 'center' }}>📅 계획 일정 변경</h4>
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontWeight: 'bold' }}>변경 착수일</label><input type="date" className="form-input" value={revisedStart} onChange={e => setRevisedStart(e.target.value)} style={{ borderColor: revisedStart !== editedTask.planned.startDate ? '#007bff' : '#ced4da' }} /></div>
              <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label" style={{ fontWeight: 'bold' }}>변경 종료일</label><input type="date" className="form-input" value={revisedEnd} onChange={e => setRevisedEnd(e.target.value)} style={{ borderColor: revisedEnd !== editedTask.planned.endDate ? '#007bff' : '#ced4da' }} /></div>
            </div> 
          </div>

          <div style={{ marginTop: '12px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', color: '#343a40', display: 'flex', alignItems: 'center' }}>⏱️ 계획 시수 변경</h4>
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 'bold' }}>하루 예상 변경 시수</label>
                <input
                  type="text"
                  className="form-input"
                  value={revisedDailyHours}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRevisedDailyHours(val);
                    const normalized = normalizeFlexibleHHMMInput(val);
                    if (normalized) {
                      const days = getCalendarDaysInclusive(
                        revisedStart || editedTask.planned.startDate || '',
                        revisedEnd || editedTask.planned.endDate || ''
                      );
                      const total = days > 0 ? hhmmToNumber(normalized) * days : 0;
                      const nextPlanned = normalizeFlexibleHHMMInput(normalizeHHMM(numberToHHMM(total))) || normalizeHHMM(numberToHHMM(total));
                      setRevisedPlannedHours(nextPlanned);
                      setPlannedHoursManuallyEdited(false);
                    }
                  }}
                  onBlur={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const normalized = normalizeFlexibleHHMMInput(val);
                    if (!normalized) {
                      window.alert('시간 형식이 올바르지 않습니다.');
                      setRevisedDailyHours(lastValidDailyRef.current);
                      return;
                    }
                    lastValidDailyRef.current = normalized;
                    setRevisedDailyHours(normalized);
                  }}
                  placeholder="예) hh.mm"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontWeight: 'bold' }}>변경 시수</label>
                <input
                  type="text"
                  className="form-input"
                  value={revisedPlannedHours}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPlannedHoursManuallyEdited(true);
                    setRevisedPlannedHours(val);
                    const normalized = normalizeFlexibleHHMMInput(val);
                    if (normalized) {
                      const days = getCalendarDaysInclusive(
                        revisedStart || editedTask.planned.startDate || '',
                        revisedEnd || editedTask.planned.endDate || ''
                      );
                      const perDay = days > 0 ? hhmmToNumber(normalized) / days : 0;
                      const nextDaily = normalizeFlexibleHHMMInput(normalizeHHMM(numberToHHMM(perDay))) || normalizeHHMM(numberToHHMM(perDay));
                      setRevisedDailyHours(nextDaily);
                      lastValidDailyRef.current = nextDaily;
                    }
                  }}
                  onBlur={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const normalized = normalizeFlexibleHHMMInput(val);
                    if (!normalized) {
                      window.alert('시간 형식이 올바르지 않습니다.');
                      setRevisedPlannedHours(lastValidPlannedRef.current);
                      return;
                    }
                    lastValidPlannedRef.current = normalized;
                    setRevisedPlannedHours(normalized);
                  }}
                  placeholder="예) hh.mm"
                />
              </div>
            </div>
            <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '6px', background: '#e7f1ff', border: '1px solid #b6d4fe', color: '#084298', fontSize: '0.85rem', lineHeight: 1.35 }}>
              일정 및 시수 변경 시 이력이 남으므로 주의 요망.
            </div>
          </div>
          
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
            <label className="form-label" style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px' }}>진행 상태 변경</label>
            <select className="form-input" value={editedTask.status} onChange={e => handleChange('status', e.target.value)} style={{ width: '100%', height: '45px', fontSize: '1rem', backgroundColor: getStatusColor(editedTask.status), fontWeight: 'bold', cursor: 'pointer' }}><option value="not-started">미시작</option><option value="in-progress">진행중</option><option value="delayed">지연</option><option value="completed">완료</option></select>
            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}>* 상태를 변경하고 저장하면 변경 이력이 자동으로 기록됩니다.</p>
          </div>
        </div>
        <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>취소</button><button className="btn btn-primary" onClick={handleSave}>저장</button></div>
      </div>
    </div>
  );
};
//2601081207

const RevisionModal = ({ isOpen, onClose, task }: { isOpen: boolean; onClose: () => void; task: Task | null }) => {
  if (!isOpen || !task) return null;

  return (
    <div className="modal show issue-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content">
        <div className="modal-header">
          <h3>이력 관리 - {task.name}</h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="issue-list-section">
            {task.revisions && task.revisions.length > 0 ? (
              <div className="issue-list">
                {task.revisions.map((rev, idx) => (
                  <div key={idx} className="issue-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', position: 'relative', padding: '15px', minHeight: '80px', border: '1px solid #dee2e6', borderRadius: '8px', marginBottom: '15px', background: '#f8f9fa' }}>
                    <div className="issue-details-wrapper" style={{ width: '100%' }}>
                      <div className="issue-meta" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span className="issue-month" style={{background:'#f1f3f5', padding:'2px 8px', borderRadius:'12px', fontSize:'0.8rem', fontWeight:'600', color:'#495057'}}>{rev.revisionDate}</span>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '5px', fontWeight: '600' }}>수정 사유</div>
                        <p className="issue-content" style={{marginTop:'8px', whiteSpace:'pre-wrap', lineHeight:'1.5', fontSize:'0.9rem', color:'#333', padding:'8px', background:'white', borderRadius:'4px', border:'1px solid #e9ecef'}}>{rev.reason}</p>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '5px', fontWeight: '600' }}>수정된 계획</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: '0.9rem' }}>
                          <div style={{ padding: '8px', background: 'white', borderRadius: '4px', border: '1px solid #e9ecef' }}>
                            <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '3px' }}>시작일</div>
                            <div style={{ color: '#333' }}>{rev.period.startDate || '-'}</div>
                          </div>
                          <div style={{ padding: '8px', background: 'white', borderRadius: '4px', border: '1px solid #e9ecef' }}>
                            <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '3px' }}>종료일</div>
                            <div style={{ color: '#333' }}>{rev.period.endDate || '-'}</div>
                          </div>
                          <div style={{ padding: '8px', background: 'white', borderRadius: '4px', border: '1px solid #e9ecef' }}>
                            <div style={{ fontSize: '0.75rem', color: '#6c757d', marginBottom: '3px' }}>계획MH</div>
                            <div style={{ color: '#333' }}>{rev.period.hours}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-issue-list" style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                등록된 이력이 없습니다.
              </p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
};

const IssueModal = ({ isOpen, onClose, task, onUpdate, user, organization }: { isOpen: boolean; onClose: () => void; task: Task | null; onUpdate: (task: Task) => void, user: UserContextType; organization: Organization }) => {
  const getTodayStr = () => { const today = new Date(); const kstOffset = 9 * 60 * 60 * 1000; return new Date(today.getTime() + kstOffset).toISOString().split('T')[0]; };
  const [newIssueText, setNewIssueText] = useState('');
  const [newIssueDate, setNewIssueDate] = useState(getTodayStr());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editContent, setEditContent] = useState('');
  const [replyIndex, setReplyIndex] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [deleteTargetIndex, setDeleteTargetIndex] = useState<number | null>(null);
  const [deleteReplyTarget, setDeleteReplyTarget] = useState<{ issueIndex: number, replyId: string } | null>(null);
  const savedScrollPositionRef = useRef<number>(0);

  // 모달 열릴 때 스크롤 위치 저장, 닫힐 때 복원
  useEffect(() => {
    if (isOpen) {
      // 모달이 열릴 때 현재 스크롤 위치 저장
      savedScrollPositionRef.current = window.scrollY || document.documentElement.scrollTop || 0;
    } else {
      // 모달이 닫힐 때 저장된 스크롤 위치로 복원
      if (savedScrollPositionRef.current > 0) {
        window.scrollTo(0, savedScrollPositionRef.current);
        savedScrollPositionRef.current = 0;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setNewIssueDate(getTodayStr()); setNewIssueText(''); setEditingIndex(null); setReplyIndex(null); setDeleteTargetIndex(null); setDeleteReplyTarget(null);
    }
  }, [isOpen]);

  // ESC: 최상단 모달만 닫기 (확인팝업/이슈수정/이슈관리 순)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (deleteReplyTarget !== null) {
        setDeleteReplyTarget(null);
        return;
      }
      if (deleteTargetIndex !== null) {
        setDeleteTargetIndex(null);
        return;
      }
      if (editingIndex !== null) {
        setEditingIndex(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, deleteReplyTarget, deleteTargetIndex, editingIndex, onClose]);

  if (!isOpen || !task) return null;

  const canReview = user ? canReviewTask(user, task, organization) : false;
  const canDeleteIssue = user ? user.role !== 'member' : false;

    const handleAddIssue = () => {
      if (!newIssueText.trim()) return;
      const regLabel = getTaskRegistrationLabel(task);
      const newIssue: Issue = {
        date: newIssueDate,
        issue: regLabel ? `[${regLabel}] ${newIssueText}` : newIssueText,
        author: user?.name || '알 수 없음',
        reviewed: false,
        replies: []
      };
      const updatedTask = { ...task, monthlyIssues: [...task.monthlyIssues, newIssue] };
      onUpdate(updatedTask);
      setNewIssueText('');
    };
// ... (IssueModal 컴포넌트 내부)

  // [수정] 검토 상태 토글 함수 (검토 취소 기능 허용)
  const handleToggleReview = (index: number) => {
    if (!canReview) { alert("검토 권한이 없습니다."); return; }
    
    // [삭제됨] 기존에는 이미 검토된 경우 변경을 막았으나, 취소를 위해 이 부분을 제거합니다.
    // const issue = task.monthlyIssues[index];
    // if (issue.reviewed) { window.alert("검토 완료된 상태는 변경할 수 없습니다."); return; }

    const updatedIssues = task.monthlyIssues.map((item, i) => { 
      if (i === index) return { ...item, reviewed: !item.reviewed }; // true <-> false 토글
      return item; 
    });
    
    onUpdate({ ...task, monthlyIssues: updatedIssues });
    
    // (선택 사항) 검토 완료(false -> true)로 변경되는 순간에만 댓글 창을 열고 싶다면 아래 조건 유지
    // 여기서는 단순히 토글만 수행합니다.
  };
  const handleToggleReplyCheck = (issueIndex: number, replyId: string) => { const updatedIssues = task.monthlyIssues.map((issue, idx) => { if (idx !== issueIndex) return issue; const updatedReplies = (issue.replies || []).map(r => { if (typeof r === 'object' && r.id === replyId) { return { ...r, checked: !r.checked }; } return r; }); return { ...issue, replies: updatedReplies }; }); onUpdate({ ...task, monthlyIssues: updatedIssues }); };
  const handleOpenEdit = (index: number, issue: Issue) => { if (issue.reviewed) { window.alert("검토 완료된 항목은 수정할 수 없습니다."); return; } setEditingIndex(index); setEditDate(issue.date || issue.month + '-01'); setEditContent(issue.issue); };
  const saveEdit = () => { if (editingIndex === null) return; const updatedIssues = task.monthlyIssues.map((issue, i) => { if (i === editingIndex) { return { ...issue, date: editDate, issue: editContent, reviewed: false, replies: issue.replies }; } return issue; }); onUpdate({ ...task, monthlyIssues: updatedIssues }); setEditingIndex(null); };
  const toggleReplySection = (index: number) => { if (replyIndex === index) setReplyIndex(null); else { setReplyIndex(index); setReplyText(''); } };
  const addReply = (index: number) => { if (!replyText.trim()) return; const now = new Date(); const timestamp = now.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\. /g, '-').replace('.', ''); const newReply: Reply = { id: Date.now().toString() + Math.random().toString(), text: replyText, timestamp: timestamp, checked: false, author: user?.name || '알 수 없음' }; const updatedIssues = task.monthlyIssues.map((issue, i) => { if (i === index) { const safeReplies = (issue.replies || []).map(r => typeof r === 'string' ? { id: Math.random().toString(), text: r, timestamp: '-', checked: true, author: '알 수 없음' } : r); return { ...issue, replies: [...safeReplies, newReply] }; } return issue; }); onUpdate({ ...task, monthlyIssues: updatedIssues }); setReplyText(''); };
  const deleteReply = (e: React.MouseEvent, issueIndex: number, replyId: string) => { e.stopPropagation(); setDeleteReplyTarget({ issueIndex, replyId }); };
  const executeDeleteReply = () => {
    if (!deleteReplyTarget) return;
    const { issueIndex, replyId } = deleteReplyTarget;
    const issue = task.monthlyIssues[issueIndex];
    const reply = issue?.replies?.find(r => typeof r === 'object' && r.id === replyId);
    const isChecked = !!(reply && typeof reply === 'object' && reply.checked);
    const isAdmin = user?.role === 'admin';
    if (isChecked && !isAdmin) {
      window.alert("확인 처리된 답글은 관리자만 삭제할 수 있습니다.");
      setDeleteReplyTarget(null);
      return;
    }
    const updatedIssues = task.monthlyIssues.map((issue, idx) => {
      if (idx !== issueIndex) return issue;
      return { ...issue, replies: issue.replies?.filter(r => (typeof r === 'object' ? r.id !== replyId : true)) };
    });
    onUpdate({ ...task, monthlyIssues: updatedIssues });
    setDeleteReplyTarget(null);
  };
  const executeDeleteIssue = () => {
    if (deleteTargetIndex === null) return;
    if (!canDeleteIssue) {
      window.alert("담당자는 이슈를 삭제할 수 없습니다.");
      setDeleteTargetIndex(null);
      return;
    }
    const targetIssue = task.monthlyIssues[deleteTargetIndex];
    if (targetIssue?.reviewed && user?.role !== 'admin') {
      window.alert("검토완료된 이슈는 관리자만 삭제할 수 있습니다.");
      setDeleteTargetIndex(null);
      return;
    }
    const updatedIssues = task.monthlyIssues.filter((_, i) => i !== deleteTargetIndex);
    onUpdate({ ...task, monthlyIssues: updatedIssues });
    if (replyIndex === deleteTargetIndex) setReplyIndex(null);
    setDeleteTargetIndex(null);
  };

  return (
    // [중요] 화면(바깥) 클릭으로 모달 이탈/클릭-스루 방지
    <div
      className="modal show issue-modal"
      style={{ zIndex: 10000 }}
      onMouseDown={(e) => {
        // 배경 클릭이어도 닫히지 않도록 + 뒤 화면 클릭 방지
        e.stopPropagation();
      }}
    >
      <div className="modal-content" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header"><h3>이슈 관리 - {task.name}</h3><button className="modal-close-btn" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="issue-list-section">
            {task.monthlyIssues.length === 0 ? (<p className="empty-issue-list">등록된 이슈가 없습니다.</p>) : (
              <div className="issue-list">
                {task.monthlyIssues.map((issue, idx) => {
                  const displayDate = issue.date || issue.month;
                  const issueAuthor = issue.author || '알 수 없음';
                  return (
                    <div key={idx} className={`issue-item ${issue.reviewed ? 'reviewed' : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', position: 'relative', padding: '15px 15px 15px 15px', minHeight: '80px' }}>
                      <div className="issue-details-wrapper" style={{ width: '100%', paddingRight: '130px' }}>
                        <div className="issue-meta" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="issue-month" style={{background:'#f1f3f5', padding:'2px 8px', borderRadius:'12px', fontSize:'0.8rem', fontWeight:'600', color:'#495057', marginRight:'2px'}}>{displayDate}</span>
                          <span style={{background:'#fff', border:'1px solid #dee2e6', padding:'2px 8px', borderRadius:'12px', fontSize:'0.8rem', fontWeight:'600', color:'#343a40'}} title={`작성자: ${issueAuthor}`}>{issueAuthor}</span>
                          <span className={`issue-status-tag ${issue.reviewed ? 'reviewed' : ''}`}>{issue.reviewed ? '검토완료' : '미검토'}</span>
                        </div>
                        <p className="issue-content" style={{marginTop:'8px', whiteSpace:'pre-wrap', lineHeight:'1.5'}}>{issue.issue}</p>
                      </div>
                      <div
                        className="issue-actions"
                        style={{
                          position: 'absolute',
                          top: '15px',
                          right: '15px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          zIndex: 100,
                          backgroundColor: 'rgba(255, 255, 255, 0.8)',
                          borderRadius: '20px',
                          padding: '2px'
                        }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenEdit(idx, issue);
                          }}
                          title={issue.reviewed ? "검토 완료되어 수정 불가 (검토 취소 후 수정 가능)" : "수정"}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: issue.reviewed ? 'not-allowed' : 'pointer',
                            fontSize: '1.1rem',
                            color: issue.reviewed ? '#adb5bd' : '#007bff',
                            padding: '4px',
                            pointerEvents: 'auto'
                          }}
                        >
                          ✏️
                        </button>
                          
                          {/* [수정됨] 검토 토글 버튼 */}
                          <div onClick={(e) => { e.stopPropagation(); handleToggleReview(idx); }} 
                              style={{ 
                                width: '42px', 
                                height: '24px', 
                                backgroundColor: issue.reviewed ? '#20c997' : '#dee2e6', 
                                borderRadius: '12px', 
                                position: 'relative', 
                                // [수정] 권한이 있다면 상태와 상관없이 클릭 가능하도록 pointer 설정
                                cursor: canReview ? 'pointer' : 'not-allowed', 
                                transition: 'background-color 0.2s', 
                                flexShrink: 0, 
                                pointerEvents: 'auto' 
                              }} 
                              // [수정] 툴팁 메시지 변경: 취소 가능함을 명시
                              title={!canReview ? "검토 권한 없음" : (issue.reviewed ? "클릭하여 검토 취소" : "클릭하여 검토 완료 처리")}
                          >
                            <div style={{ width: '20px', height: '20px', backgroundColor: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: issue.reviewed ? '20px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                          </div>

                          <button onClick={(e) => { e.stopPropagation(); toggleReplySection(idx); }} style={{border:'none', background:'none', cursor:'pointer', fontSize:'0.8rem', color:'#868e96', transform: replyIndex === idx ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', padding:'4px', marginLeft:'4px'}}>▼</button>
                          {(() => {
                            const canDeleteThisIssue = canDeleteIssue && (!issue.reviewed || user?.role === 'admin');
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!canDeleteThisIssue) return;
                                  setDeleteTargetIndex(idx);
                                }}
                                title={
                                  !canDeleteIssue
                                    ? "담당자는 이슈를 삭제할 수 없습니다."
                                    : (!canDeleteThisIssue ? "검토완료된 이슈는 관리자만 삭제할 수 있습니다." : "삭제")
                                }
                                style={{
                                  border: '1px solid #ced4da',
                                  background: 'white',
                                  color: '#e03131',
                                  cursor: canDeleteThisIssue ? 'pointer' : 'not-allowed',
                                  width: '20px',
                                  height: '20px',
                                  borderRadius: '4px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.95rem',
                                  lineHeight: '1',
                                  padding: 0,
                                  opacity: canDeleteThisIssue ? 1 : 0.45
                                }}
                                disabled={!canDeleteThisIssue}
                              >
                                🗑️
                              </button>
                            );
                          })()}
                      </div>
                      {replyIndex === idx && (
                        <div className="issue-reply-section" style={{marginTop:'15px', paddingTop:'12px', borderTop:'1px dashed #e9ecef', backgroundColor:'#f8f9fa', padding:'15px', borderRadius:'8px'}}>
                          {issue.replies && issue.replies.length > 0 && (
                            <ul style={{listStyle:'none', padding:0, margin:'0 0 15px 0'}}>
                              {issue.replies.map((reply) => {
                                const isObj = typeof reply === 'object';
                                const rText = isObj ? reply.text : reply;
                                const rTime = isObj ? reply.timestamp : '';
                                const rId = isObj ? reply.id : Math.random().toString();
                                const isChecked = isObj ? !!reply.checked : true;
                                const rAuthor = isObj ? (reply.author || '알 수 없음') : '알 수 없음';
                                const isOwnReply = !!user && rAuthor === (user.name || '');
                                return (
                                  <li key={rId} style={{ backgroundColor: 'white', border: '1px solid #dee2e6', borderRadius: '6px', padding: '10px', marginBottom: '8px', position: 'relative' }}>
                                    <div style={{paddingRight: '70px'}}>
                                      <div style={{fontSize:'0.75rem', color:'#adb5bd', marginBottom:'4px', display: 'flex', alignItems: 'center', gap: '6px'}}><span style={{fontWeight: '600', color: '#495057'}}>{rAuthor}</span> {rTime}{isChecked && <span style={{color: '#20c997', fontWeight: 'bold', fontSize: '0.7rem', border: '1px solid #20c997', padding: '0 4px', borderRadius: '4px'}}>확인됨</span>}</div>
                                      <div style={{ lineHeight: '1.4', fontSize:'0.9rem', color: isChecked ? '#adb5bd' : '#212529', textDecoration: isChecked ? 'line-through' : 'none', textDecorationColor: '#ced4da' }}>{rText}</div>
                                    </div>
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // 본인이 작성한 답글은 "확인 완료" 토글 불가
                                        if (isOwnReply) return;
                                        handleToggleReplyCheck(idx, rId);
                                      }}
                                      style={{
                                        position: 'absolute',
                                        top: '10px',
                                        right: '36px',
                                        width: '34px',
                                        height: '20px',
                                        backgroundColor: isChecked ? '#20c997' : '#dee2e6',
                                        borderRadius: '10px',
                                        cursor: isOwnReply ? 'not-allowed' : 'pointer',
                                        transition: 'background-color 0.2s',
                                        zIndex: 5,
                                        opacity: isOwnReply ? 0.45 : 1
                                      }}
                                      title={isOwnReply ? "본인이 작성한 답글은 확인 처리할 수 없습니다." : (isChecked ? "확인 취소" : "확인 완료")}
                                    >
                                      <div style={{ width: '16px', height: '16px', backgroundColor: 'white', borderRadius: '50%', position: 'absolute', top: '2px', left: isChecked ? '16px' : '2px', transition: 'left 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                                    </div>
                                    {(() => {
                                      const isAdmin = user?.role === 'admin';
                                      const canDeleteThisReply = !isChecked || isAdmin;
                                      return (
                                        <button
                                          onClick={(e) => {
                                            if (!canDeleteThisReply) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              return;
                                            }
                                            deleteReply(e, idx, rId);
                                          }}
                                          style={{
                                            position: 'absolute',
                                            top: '10px',
                                            right: '8px',
                                            border: '1px solid #ced4da',
                                            background: 'white',
                                            color: '#e03131',
                                            cursor: canDeleteThisReply ? 'pointer' : 'not-allowed',
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '1rem',
                                            lineHeight: '1',
                                            padding: 0,
                                            zIndex: 5,
                                            opacity: canDeleteThisReply ? 1 : 0.45
                                          }}
                                          title={canDeleteThisReply ? "답변 삭제" : "확인 처리된 답글은 관리자만 삭제할 수 있습니다."}
                                          disabled={!canDeleteThisReply}
                                        >
                                          ×
                                        </button>
                                      );
                                    })()}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
                            <span style={{fontSize:'1.2rem', color: '#ced4da'}}>↳</span>
                            <input type="text" className="form-input" style={{flex:1, fontSize:'0.9rem', padding:'8px'}} placeholder="답변/코멘트를 입력하세요..." value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addReply(idx)} />
                            <button className="btn btn-primary" onClick={() => addReply(idx)} style={{padding:'8px 16px', fontSize:'0.9rem'}}>등록</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="issue-add-container" style={{marginTop:'20px', paddingTop:'20px', borderTop:'2px solid #f1f3f5'}}>
            <label className="form-label" style={{fontWeight:'bold', marginBottom:'10px', display:'block'}}>새 이슈 등록</label>
            <div className="issue-add-form" style={{display:'flex', gap:'10px', alignItems:'flex-start'}}>
              <input type="date" className="form-input" style={{ width: '140px', padding:'8px' }} value={newIssueDate} onChange={e => setNewIssueDate(e.target.value)} />
              <textarea className="form-input" placeholder="이슈 내용을 입력하세요" value={newIssueText} onChange={e => setNewIssueText(e.target.value)} style={{flex:1, height:'60px', padding:'8px'}} />
              <button className="btn btn-primary" onClick={handleAddIssue} style={{height:'60px', padding:'0 20px'}}>등록</button>
            </div>
          </div>
        </div>
        {editingIndex !== null && (
          <div
            className="modal-overlay-edit"
            style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', backgroundColor:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex: 20000 }}
            // 화면 클릭으로 이탈/클릭-스루 방지 (닫힘은 ESC 또는 버튼으로만)
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="edit-box" style={{background:'white', padding:'25px', borderRadius:'12px', width:'80%', maxWidth:'400px', boxShadow:'0 10px 25px rgba(0,0,0,0.2)'}} onMouseDown={(e) => e.stopPropagation()}>
              <h4 style={{marginTop:0, marginBottom:'15px'}}>이슈 수정</h4>
              <div className="form-group"><label className="form-label">날짜</label><input type="date" className="form-input" value={editDate} onChange={e => setEditDate(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">내용</label><textarea className="form-input" style={{height:'100px'}} value={editContent} onChange={e => setEditContent(e.target.value)} /></div>
              <div style={{display:'flex', justifyContent:'flex-end', gap:'10px', marginTop:'20px'}}>
                <button className="btn btn-secondary" onClick={() => setEditingIndex(null)}>취소</button>
                <button className="btn btn-primary" onClick={saveEdit}>수정 완료</button>
              </div>
            </div>
          </div>
        )}
        {deleteTargetIndex !== null && <ConfirmModal isOpen={true} message="이 이슈를 정말 삭제하시겠습니까? (복구할 수 없습니다)" onConfirm={executeDeleteIssue} onCancel={() => setDeleteTargetIndex(null)} zIndex={4000} />}
        {deleteReplyTarget !== null && <ConfirmModal isOpen={true} message="선택한 답변을 삭제하시겠습니까?" onConfirm={executeDeleteReply} onCancel={() => setDeleteReplyTarget(null)} zIndex={4000} />}
      </div>
    </div>
  );
};

// [수정] TaskDetailModal: onToggleActive prop 추가 및 헤더에 토글 버튼 구현
// [수정] TaskDetailModal: 헤더에 '숨김/활성' 토글 버튼 추가
// [중요 수정] TaskDetailModal: 숨김/활성 토글 버튼 추가
// - 녹색 동그라미 영역에 해당하는 헤더 우측에 토글 버튼을 배치
// [수정] TaskDetailModal: 헤더의 '숨김/활성' 토글 버튼 제거
const TaskDetailModal = ({ task, onClose, currentUser }: { task: Task | null; onClose: () => void; currentUser?: UserContextType | null }) => {
  if (!task) return null;
  const currentPlan = getCurrentPlan(task);
  const statusMap = { 'completed': { text: '완료', className: 'status-completed' }, 'in-progress': { text: '진행중', className: 'status-progress' }, 'delayed': { text: '지연', className: 'status-delayed' }, 'not-started': { text: '미시작', className: 'status-pending' } };
  
  // 권한별 정보 숨김 로직
  let shouldHideGroupInfo = false;
  let shouldHideTeamInfo = false;
  let shouldHideDeptInfo = false;
  
  if (currentUser) {
    const isMember = currentUser.role === 'member';
    const isGroupLeader = currentUser.role === 'group_leader';
    const isTeamLeader = currentUser.role === 'team_leader';
    
    // 담당자: 실장/팀장/그룹장 정보 모두 숨김
    if (isMember) {
      shouldHideGroupInfo = true;
      shouldHideTeamInfo = true;
      shouldHideDeptInfo = true;
    }
    // 그룹장: 실장/팀장 정보 숨김
    else if (isGroupLeader) {
      shouldHideTeamInfo = true;
      shouldHideDeptInfo = true;
    }
    // 팀장: 실장 정보 숨김
    else if (isTeamLeader) {
      shouldHideDeptInfo = true;
    }
  }
  
  // 담당자 정보 표시 (그룹 정보는 권한에 따라 조건부 표시)
  const assigneeDisplay = shouldHideGroupInfo 
    ? task.assigneeName 
    : `${task.assigneeName} (${task.group})`;
  
  return (
    <div className="modal show detail-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ zIndex: 9999 }}> 
      <div className="modal-content"> 
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <h3 style={{ margin: 0 }}>Task 상세 정보</h3>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* [삭제됨] 숨김/활성 토글 버튼 제거 */}
            
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: 'static', background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6b7280', fontWeight: 'bold', fontSize: '1.2rem', zIndex: 10000, flexShrink: 0 }} title="닫기">×</button>
          </div>
        </div> 
        <div className="modal-body"> 
          <div className="detail-item"><span className="detail-label">Task Code</span><span className="detail-value">{formatTaskCode(task.taskCode)}</span></div> 
          <div className="detail-item"><span className="detail-label">Task2</span><span className="detail-value">{task.name}</span></div> 
          <div className="detail-item"><span className="detail-label">카테고리</span><span className="detail-value">{task.category1} &gt; {task.category2} &gt; {task.category3}</span></div> 
          <div className="detail-item">
            <span className="detail-label">담당자</span>
            <span className="detail-value">
              {assigneeDisplay}
            </span>
          </div> 
          <div className="detail-item"><span className="detail-label">상태</span><span className="detail-value"><span className={`status-badge ${statusMap[task.status].className}`}>{statusMap[task.status].text}</span></span></div> 
          
          {/* [삭제됨] 비활성 상태 안내 문구 제거 */}

          <h4 className="form-section-header">기간 및 시수</h4> 
          <div className="detail-item"><span className="detail-label">현재 계획</span><span className="detail-value">{currentPlan.startDate} ~ {currentPlan.endDate} ({currentPlan.hours})</span></div> 
          <div className="detail-item"><span className="detail-label">실적</span><span className="detail-value">{task.actual.startDate || '-'} ~ {task.actual.endDate || '-'} ({task.actual.hours})</span></div> 
        </div> 
      </div> 
    </div>
  );
};

const fetchDailyLimitFromExternal = async (dateStr: string): Promise<number> => {
  return new Promise((resolve) => { setTimeout(() => resolve(8.0), 100); });
};

const DailyPerformanceModal = ({ isOpen, onClose, tasks, onSave }: { isOpen: boolean; onClose: () => void; tasks: Task[]; onSave: (data: any) => void }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [inputs, setInputs] = useState<{ [taskId: string]: string }>({});
  const [dailyLimit, setDailyLimit] = useState<number>(8.0); 
  // [수정] 완료된 Task는 목록에서 제외하여 불필요한 스크롤 방지 (필요 시 제거 가능)
  const activeTasks = useMemo(() => tasks.filter(t => t.isActive !== false && t.status !== 'completed'), [tasks]);

  const normalizeDailyTimeInput = (raw: string): string | null => {
    const s = (raw ?? '').trim();
    if (!s) return null;
    if (!/^\d+(\.\d*)?$/.test(s)) return null;
    const [hStr, mRaw] = s.split('.');
    const h = parseInt(hStr, 10);
    if (Number.isNaN(h) || h < 0) return null;

    // "8" or "8." 형태는 시간만 입력으로 간주
    if (mRaw === undefined || mRaw.length === 0) {
      return `${h}.00`;
    }

    // 소수점 1자리: 10분 단위, 2자리: 분, 3자리 이상: 올림 처리(0.01 이하 올림 포함)
    const head2 = mRaw.padEnd(2, '0').slice(0, 2);
    let m = parseInt(head2, 10);
    if (Number.isNaN(m)) return null;
    const rest = mRaw.slice(2);
    const shouldCeil = rest.length > 0 && /[1-9]/.test(rest);
    if (shouldCeil) m += 1;
    if (m < 0 || m > 60) return null;
    return `${h}.${String(m).padStart(2, '0')}`;
  };

  const dailyInputToHours = (raw: string): number => {
    const normalized = normalizeDailyTimeInput(raw);
    if (!normalized) return 0;
    return hhmmToNumber(normalized);
  };

  useEffect(() => {
    if (isOpen) {
      const dateStr = currentDate.toISOString().split('T')[0];
      fetchDailyLimitFromExternal(dateStr).then(limit => setDailyLimit(limit));
      const loadedInputs: { [key: string]: string } = {};
      activeTasks.forEach(task => { if (task.dailyLogs && task.dailyLogs[dateStr] !== undefined) { loadedInputs[task.id] = task.dailyLogs[dateStr]; } });
      setInputs(loadedInputs);
    }
  }, [isOpen, currentDate, activeTasks]);

  const handleDateChange = (days: number) => { const newDate = new Date(currentDate); newDate.setDate(newDate.getDate() + days); setCurrentDate(newDate); };
  const handleDateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const val = e.target.value; if (val) { setCurrentDate(new Date(val)); } };
  const totalUsed = useMemo(() => Object.values(inputs).reduce((sum: number, val: string) => sum + dailyInputToHours(val), 0), [inputs]);
  const remaining = dailyLimit - totalUsed;
  const handleInputChange = (taskId: string, valueStr: string) => {
    if (valueStr === '') { const newInputs = { ...inputs }; delete newInputs[taskId]; setInputs(newInputs); return; }

    // 입력 중 허용 포맷: "8", "8.", "08.3", "0.02" 등 (숫자/점만)
    const raw = valueStr.trim();
    if (!/^\d+(\.\d{0,2})?$/.test(raw)) {
      setInputs(prev => ({ ...prev, [taskId]: valueStr }));
      return;
    }

    // 분(mm) 규칙은 입력 중에도 즉시 차단 (0.7 -> 70분이므로 불가)
    if (raw.includes('.')) {
      const [, mRaw = ''] = raw.split('.');
      if (mRaw.length > 0) {
        const mmStr = mRaw.padEnd(2, '0').slice(0, 2);
        const m = parseInt(mmStr, 10);
        if (!Number.isNaN(m) && m > 60) {
          alert('mm(분)은 60을 초과할 수 없습니다.');
          return;
        }
      }
    }

    // 총 가능 시간 초과 체크 (현재 입력값 기준으로 계산)
    const currentTaskOldValue = dailyInputToHours(inputs[taskId] || '');
    const newValue = dailyInputToHours(raw);
    const futureTotal = totalUsed - currentTaskOldValue + newValue;
    if (futureTotal > dailyLimit) { alert(`총 가능 시간(${dailyLimit.toFixed(1)}시간)을 초과할 수 없습니다.`); return; }

    // 입력 중에는 사용자가 입력한 형태를 유지 (blur 시 정규화)
    setInputs(prev => ({ ...prev, [taskId]: raw }));
  };
  
  const handleInputBlur = (taskId: string, valueStr: string) => {
    if (!valueStr) return;

    const normalized = normalizeDailyTimeInput(valueStr);
    if (!normalized) {
      alert('시간 입력 형식이 올바르지 않습니다.');
      const newInputs = { ...inputs };
      delete newInputs[taskId];
      setInputs(newInputs);
      return;
    }

    const newValue = hhmmToNumber(normalized);
    const currentTaskOldValue = dailyInputToHours(inputs[taskId] || '');
    const futureTotal = totalUsed - currentTaskOldValue + newValue;
    if (futureTotal > dailyLimit) {
      alert(`총 가능 시간(${dailyLimit.toFixed(1)}시간)을 초과할 수 없습니다.`);
      return;
    }

    setInputs(prev => ({ ...prev, [taskId]: normalized }));
  };
  const handleSave = () => {
    // 저장 시 전체 입력값을 hh.mm으로 정규화하여 parent로 전달
    const normalizedInputs: { [taskId: string]: string } = {};
    for (const [taskId, raw] of Object.entries(inputs) as Array<[string, string]>) {
      const normalized = normalizeDailyTimeInput(raw);
      if (!normalized) {
        alert('시간 입력 형식이 올바르지 않은 값이 있습니다.');
        return;
      }
      // 00.00은 저장하지 않도록 (기존 로직과 동일)
      if (normalized !== '00.00') normalizedInputs[taskId] = normalized;
    }
    const total = Object.values(normalizedInputs).reduce((sum, v) => sum + hhmmToNumber(v), 0);
    if (total > dailyLimit) {
      alert(`총 가능 시간(${dailyLimit.toFixed(1)}시간)을 초과할 수 없습니다.`);
      return;
    }
    const dateStr = currentDate.toISOString().split('T')[0];
    onSave({ date: dateStr, data: normalizedInputs });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal show" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/* [수정] maxWidth를 600px -> 800px로 확장하고 width: 95% 추가하여 가로폭 확보 */}
      <div className="modal-content" style={{ maxWidth: '800px', width: '95%', display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
        
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderBottom: '1px solid #eee' }}>
          <h3 style={{ margin: 0 }}>일일 실적 입력</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}> 
            <button className="btn btn-secondary btn-sm" onClick={() => handleDateChange(-1)}>◀</button> 
            <input type="date" value={currentDate.toISOString().split('T')[0]} onChange={handleDateInputChange} style={{ fontSize: '1.1em', fontWeight: 'bold', border: '1px solid #666', borderRadius: '4px', padding: '4px 8px', color: 'white', backgroundColor: '#444', fontFamily: 'inherit', cursor: 'pointer', colorScheme: 'dark' }} />
            <button className="btn btn-secondary btn-sm" onClick={() => handleDateChange(1)}>▶</button> 
          </div> 
          <button className="modal-close-btn" onClick={onClose} style={{ fontSize: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: '0 5px' }}>×</button>
        </div>

        <div style={{ padding: '15px 20px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}> <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '2px' }}>총 가능 시간</div> <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#333' }}>{dailyLimit.toFixed(1)}h</div> </div>
          <div style={{ height: '30px', width: '1px', backgroundColor: '#ddd' }}></div>
          <div style={{ textAlign: 'center' }}> <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '2px' }}>입력 합계</div> <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#007bff' }}>{totalUsed.toFixed(1)}h</div> </div>
          <div style={{ height: '30px', width: '1px', backgroundColor: '#ddd' }}></div>
          <div style={{ textAlign: 'center' }}> <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '2px' }}>잔여 시간</div> <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: remaining < 0 ? '#dc3545' : '#28a745' }}>{remaining.toFixed(1)}h</div> </div>
        </div>

        <div className="modal-body" style={{ overflowY: 'auto', padding: '10px' }}>
          {activeTasks.length === 0 ? (<p style={{ textAlign: 'center', color: '#999', padding: '30px' }}>입력 가능한 진행 중인 Task가 없습니다.</p>) : (
            
            /* [수정] 테이블 스타일 변경: minWidth: '0' 추가, tableLayout: 'fixed' 설정 */
            <table style={{width: '100%',  borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '0' }}> 
              <thead> 
                <tr style={{ borderBottom: '2px solid #eee', color: '#666' }}> 
                  {/* [수정] Task 컬럼 70%, 시간 컬럼 30% 비율 할당 */}
                  <th style={{ padding: '10px', width: '70%', textAlign: 'left' }}>Task</th> 
                  <th style={{ padding: '10px', width: '30%', textAlign: 'center' }}>시간 (h)</th> 
                </tr> 
              </thead> 
              <tbody> 
                {activeTasks.map(task => (
                  <tr key={task.id} style={{ borderBottom: '1px solid #f0f0f0' }}> 
                    <td style={{ padding: '12px 8px', verticalAlign: 'middle' }}> 
                      {/* [수정] 긴 텍스트 줄바꿈 처리 */}
                      <div style={{ fontWeight: '600', fontSize: '0.95em', color: '#333', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: '1.4' }}>
                        {task.name}
                      </div> 
                      <div style={{ fontSize: '0.8em', color: '#999', marginTop: '4px' }}>{formatTaskCode(task.taskCode)}</div> 
                    </td> 
                    <td style={{ padding: '8px', verticalAlign: 'middle' }}> 
                      <input 
                        type="text" 
                        className="form-input" 
                        style={{ width: '100%', textAlign: 'center' }} 
                        placeholder="예) hh.mm" 
                        pattern="\d+(\.\d{0,2})?" 
                        value={inputs[task.id] !== undefined ? inputs[task.id] : ''} 
                        onChange={e => handleInputChange(task.id, e.target.value)}
                        onBlur={e => handleInputBlur(task.id, e.target.value)}
                        title="예) hh.mm"
                      /> 
                    </td> 
                  </tr>
                ))} 
              </tbody> 
            </table>

          )}
        </div>
        <div className="modal-footer"> <button className="btn btn-secondary" onClick={onClose}>취소</button> <button className="btn btn-primary" onClick={handleSave}>저장</button> </div>
      </div>
    </div>
  );
};




const App = () => {
  const LOGO_IMG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 50'%3E%3Ctext x='0' y='38' font-family='Arial, sans-serif' font-weight='bold' font-size='36' fill='%23004085'%3ES-Core%3C/text%3E%3Ctext x='130' y='38' font-family='Arial, sans-serif' font-weight='bold' font-size='36' fill='%236c757d'%3EFlow%3C/text%3E%3C/svg%3E";

  const GlobalStyles = () => (
    <style>{`
      * { box-sizing: border-box; }
      body { font-family: 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; color: #333; }
      ul { list-style: none; padding: 0; margin: 0; }
      a { text-decoration: none; color: inherit; }
      .app-layout { display: flex; height: 100vh; overflow: hidden; }
      .sidebar { width: 240px; background: #2c3e50; color: white; flex-shrink: 0; transition: all 0.3s ease; display: flex; flexDirection: column; position: relative; z-index: 2000; }
      .sidebar.collapsed { width: 60px; }
      .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 20px; height: 60px; border-bottom: 1px solid rgba(255,255,255,0.1); }
      .sidebar h2 { margin: 0; font-size: 1.2rem; white-space: nowrap; overflow: hidden; }
      .sidebar-toggle-btn { background: transparent; border: none; color: white; font-size: 1.2rem; cursor: pointer; padding: 5px; border-radius: 4px; }
      .sidebar-toggle-btn:hover { background: rgba(255,255,255,0.1); }
      .sidebar-nav { flex: 1; padding: 20px 0; overflow-y: auto; }
      .sidebar-nav li a { display: flex; align-items: center; padding: 12px 20px; color: #adb5bd; transition: all 0.2s; white-space: nowrap; overflow: hidden; }
      .sidebar-nav li a:hover, .sidebar-nav li.active a { background: rgba(255,255,255,0.1); color: white; border-left: 4px solid #4e73df; }
      .nav-icon { margin-right: 15px; font-size: 1.1rem; min-width: 24px; text-align: center; }
      .sidebar.collapsed .nav-text { display: none; }
      .sidebar.collapsed .sidebar-header h2 { display: none; }
      .sidebar.collapsed .nav-icon { margin-right: 0; }
      
      .main-content { flex: 1; display: flex; flexDirection: column; height: 100vh; overflow-y: auto; background-color: #f8f9fa; }
      .sticky-header-container { position: sticky; top: 0; z-index: 1000; background: #f8f9fa; }
      .header { display: flex; align-items: center; padding: 15px 30px; background: white; border-bottom: 1px solid #e0e0e0; }
      .header-buttons { margin-left: auto; display: flex; gap: 10px; }
      .view-controls { display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 7px 30px; background: white; border-bottom: 1px solid #e0e0e0; }
      .view-switcher { display: flex; gap: 10px; margin-bottom: 0; flex: 0 0 auto; }
      /* 뷰 스위처 버튼: 상단 파란 버튼(.btn)과 동일한 높이/패딩으로 통일 */
      .view-switcher-btn {
        height: 38px;
        min-width: 76px;
        padding: 0 16px;
        border: 1px solid #ced4da;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        transition: all 0.2s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        white-space: nowrap; /* 텍스트는 좌우(가로)로만 */
      }
      .view-switcher-btn:hover { background: #f8f9fa; }
      .view-switcher-btn.active { background: #007bff; color: white; border-color: #007bff; font-weight: 700; }
      /* TaskListView 액션 버튼 색상 = 뷰 스위처 활성 색상 */
      .btn.btn-primary.action-btn { background: #007bff; border-color: #007bff; }
      .btn.btn-primary.action-btn:hover { background: #007bff; border-color: #007bff; }
      
      /* ✅ 초록(팀 선택) + 노란(드롭다운 묶음) 영역을 붙이기 위해 filter-wrapper가 남는 공간을 차지 */
      .filter-wrapper { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; margin-left: 12px; width: auto; }
      .filter-section { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; }
      .filter-section select { height: 38px; padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 0.9rem; }
      /* 날짜 영역은 우측 끝으로 */
      .date-range-container { display: flex; align-items: center; gap: 10px; margin-left: auto; position: relative; flex: 0 0 auto; }
      .date-range-group { display: flex; align-items: center; gap: 15px; flex: 0 0 auto; }
      .date-input-wrapper { display: flex; align-items: center; gap: 8px; }
      .date-label { font-size: 0.85rem; color: #666; font-weight: 600; }
      .date-input { height: 38px; padding: 5px 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 0.9rem; }
      .date-range-toggle-btn { display: none; height: 38px; padding: 0 10px; border: 1px solid #ddd; border-radius: 6px; background: #fff; color: #333; font-weight: 700; cursor: pointer; white-space: nowrap; }
      .date-range-toggle-btn:hover { background: #f8f9fa; }

      /* 화면이 좁아질 때: 날짜 선택은 "기간" 버튼으로 최소화 + 드롭다운(overlay) */
      @media (max-width: 1100px) {
        .date-range-toggle-btn { display: inline-flex; align-items: center; }
        .date-range-group { display: none; position: absolute; top: calc(100% + 6px); right: 0; background: #fff; border: 1px solid #e9ecef; border-radius: 10px; padding: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.08); z-index: 50; flex-direction: column; align-items: stretch; gap: 10px; min-width: 220px; }
        .date-range-group.open { display: flex; }
        .date-input-wrapper { flex-direction: column; align-items: flex-start; gap: 6px; }
        .date-input { width: 100%; }
      }
      .mobile-filter-toggle-btn { display: none; }

      .container { padding: 30px; max-width: 100%; margin: 0 auto; width: 100%; box-sizing: border-box; overflow: hidden; flex: 1; min-height: 144vh; display: flex; flex-direction: column; } /* [수정] flex 속성 추가하여 스크롤 가능하도록 수정 */
      
      .dashboard-card { background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); padding: 20px; height: 100%; display: flex; flexDirection: column; }
      .card-title { font-size: 1.1rem; font-weight: bold; margin-bottom: 15px; color: #333; display: flex; justify-content: space-between; align-items: center; }
      
      .card-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; width: 100%; }
      .card-header-row .card-title { margin-bottom: 0; margin-right: auto; }
      
      .chart-header-controls { display: flex; align-items: center; gap: 15px; flex-wrap: wrap; justify-content: flex-end; }
      .chart-filter-buttons { display: flex; gap: 5px; }
      
      .chart-legend-text { display: flex; align-items: center; gap: 12px; font-size: 0.8rem; color: #666; }
      .legend-item { display: flex; align-items: center; gap: 5px; }
      .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

      .sub-title { font-size: 0.8rem; color: #888; font-weight: normal; margin-left: 10px; }
      
      .team-dashboard { width: 100%; display: flex; flex-direction: column; gap: 20px; }
      .group-performance-card { background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); padding: 25px; width: 100%; box-sizing: border-box; }
      .group-card-header { font-size: 1.1rem; font-weight: 700; margin-bottom: 20px; padding-left: 10px; border-left: 4px solid #4e73df; color: #333; }
      .group-card-body { display: flex; gap: 30px; align-items: flex-start; width: 100%; }
      .group-stat-section { display: flex; flex-direction: column; }
      .group-stat-section.status { flex: 0 0 220px; align-items: center; }
      .group-stat-section.trend { flex: 0.9; min-width: 0; }
      /* ✅ MBO 컨테이너 넓이 10% 증가 (250px -> 275px) */
      .group-stat-section.mbo { flex: 0 0 275px; }

      .donut-center-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }
      .donut-total { font-size: 2rem; font-weight: bold; color: #333; display: block; line-height: 1; }
      .donut-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 15px; width: 100%; }
      .legend-val { font-size: 1.2rem; font-weight: bold; }
      .legend-label { font-size: 0.75rem; color: #888; margin-top: 2px; }
      .legend-pct { font-size: 0.7rem; color: #aaa; }

      .mbo-section-title { font-size: 0.9rem; font-weight: bold; margin-bottom: 10px; color: #555; border-bottom: 1px solid #eee; padding-bottom: 5px; }
      .mbo-dist-container { display: flex; flex-direction: column; gap: 8px; }
      .mbo-dist-item { width: 100%; }
      .mbo-dist-header { display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 3px; }
      .mbo-dist-name { color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
      .mbo-dist-val { font-weight: bold; color: #333; }
      .mbo-dist-track { background: #f0f0f0; height: 6px; border-radius: 3px; overflow: hidden; }
      .mbo-dist-fill { height: 100%; border-radius: 3px; }

      .calendar-stats-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; padding: 0 10px; }
      .cal-stat-card { background: white; border-radius: 10px; padding: 15px 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); display: flex; flex-direction: column; border-left: 4px solid #ddd; }
      .cal-stat-card.blue { border-left-color: #4e73df; }
      .cal-stat-card.green { border-left-color: #1cc88a; }
      .cal-stat-card.orange { border-left-color: #f6c23e; }
      .cal-stat-card.purple { border-left-color: #6f42c1; }
      .cal-stat-label { font-size: 0.85rem; color: #888; margin-bottom: 5px; font-weight: 600; }
      .cal-stat-value { font-size: 1.4rem; font-weight: 700; color: #333; }
      .cal-stat-sub { font-size: 0.8rem; color: #aaa; margin-top: 3px; }
      
      .calendar-view { display: flex; flex-direction: column; height: 100%; padding: 0 10px; width: 100%; overflow-y: auto; overflow-x: hidden; min-height: 0; } /* 기본(활성 일정): 고정 높이 + 내부 스크롤 */
      /* ✅ 활성/전체 토글에 따라 높이/스크롤 정책 변경 */
      .calendar-view.calendar-compact { height: 100%; overflow-y: auto; }
      .calendar-view.calendar-expanded { height: auto; overflow: visible; }
      .calendar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
      .calendar-title { font-size: 1.5rem; font-weight: bold; margin: 0; width: 210px; text-align: center; }
      .calendar-nav-btn { background: none; border: 1px solid #ddd; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; color: #555; transition: all 0.2s; }
      .calendar-nav-btn:hover { background-color: #f0f0f0; }
      .calendar-today-btn { background: #007bff; border: 1px solid #007bff; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.875rem; font-weight: 500; color: white; transition: all 0.2s; white-space: nowrap; }
      .calendar-today-btn:hover { background: #0056b3; border-color: #0056b3; }
      
      /* --- [핵심 수정] 캘린더 그리드 스타일 --- */
      .calendar-grid { 
        display: grid; 
        /* [중요] 1fr -> minmax(0, 1fr)로 변경하여 내용물이 길어져도 칸이 늘어나지 않게 강제함 */
        grid-template-columns: repeat(7, minmax(0, 1fr)); 
        flex: 1; 
        min-height: 0; /* flex item이 스크롤 가능하도록 설정 */
        background: #e9ecef; 
        gap: 1px; 
        border: 1px solid #e9ecef; 
        width: 100%; /* 너비 100% 강제 */
        box-sizing: border-box;
      }
      .calendar-view.calendar-expanded .calendar-grid { flex: none; min-height: initial; }
      
      .calendar-day-header { background: #f8f9fa; padding: 10px; text-align: center; font-weight: bold; color: #555; }
      .calendar-day-header:nth-child(1) { color: #e74a3b; }
      .calendar-day-header:nth-child(7) { color: #4e73df; }
      
      .calendar-day { 
        background: white; 
        padding: 5px; 
        min-height: 120px;
        height: 120px; /* ✅ 기본은 4개 정도 보이는 높이로 고정 */
        display: flex; 
        flex-direction: column; 
        position: relative; 
        /* [중요] min-width: 0와 overflow: hidden을 주어 내부 텍스트가 넘치면 잘리도록 설정 */
        min-width: 0;
        overflow: hidden;
      }
      .calendar-view.calendar-expanded .calendar-day { height: auto; overflow: visible; }
      .calendar-day.is-other-month { background: #fdfdfd; color: #ccc; }
      .calendar-day.is-today { background: #f0f8ff; }
      .day-number { font-weight: 600; margin-bottom: 5px; padding: 2px 5px; font-size: 0.9rem; }
      .is-today .day-number { background: #4e73df; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
      .day-tasks { flex: 1; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
      .calendar-view.calendar-expanded .day-tasks { flex: none; overflow: visible; }
      
      .calendar-task { 
        font-size: 0.75rem; 
        padding: 2px 4px; 
        border-radius: 3px; 
        background: #3a3b45; 
        color: white; 
        cursor: pointer; 
        /* ✅ 캘린더 내 과제 바: 높이 2배 + 자동 줄바꿈(2줄 클램프) */
        height: 40px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        align-items: flex-start;
        line-height: 1.15;
        white-space: normal; 
        overflow: hidden; 
        text-overflow: clip; 
        opacity: 0.9; 
        max-width: 100%; /* 너비 제한 */
      }
      /* ------------------------------------------- */

      .calendar-task.status-completed { background-color: #1cc88a; }
      .calendar-task.status-in-progress { background-color: #4e73df; }
      .calendar-task.status-delayed { background-color: #f6c23e; color: #333; }
      .calendar-task.status-not-started { background-color: #858796; }
      .more-tasks-indicator { font-size: 0.7rem; color: #888; text-align: center; cursor: pointer; padding: 2px; }
      .more-tasks-indicator:hover { background: #eee; border-radius: 3px; }

      .division-dashboard { display: flex; gap: 20px; height: auto; min-height: 100%; }
      .division-sidebar-panel { width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 20px; }
      .division-panel-card { background: white; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); padding: 20px; display: flex; flex-direction: column; }
      .panel-title { font-size: 1.1rem; font-weight: bold; margin-bottom: 15px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
      /* ✅ 실 대시보드 팀 카드: 3열 고정 배치 */
      .division-main-grid { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; overflow-y: auto; padding-bottom: 20px; align-items: start; align-content: start; }
      .overall-donut-container { position: relative; height: 220px; display: flex; justify-content: center; margin-bottom: 20px; }
      .overall-center-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }
      .overall-total { font-size: 2.5rem; font-weight: bold; color: #333; }
      .metric-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .metric-box { background: #f8f9fa; padding: 10px; border-radius: 6px; text-align: center; }
      .metric-label { display: block; font-size: 0.8rem; color: #666; margin-bottom: 5px; }
      .metric-val { font-size: 1.2rem; font-weight: bold; }
      .metric-pct { font-size: 0.8rem; color: #aaa; margin-left: 3px; }

      .group-dashboard-container { display: flex; gap: 20px; height: auto; align-items: flex-start; }
      .group-dashboard-container .dashboard-card { height: auto; }
      .group-dashboard-left { flex: 2; display: flex; flexDirection: column; gap: 20px; align-items: flex-start; }
      .group-dashboard-right { flex: 1; }
      .group-dashboard-right .assignee-scroll-container { max-height: 520px; overflow-y: auto; }
      .donut-legend-vertical { display: flex; flex-direction: column; gap: 8px; justify-content: center; margin-left: 20px; }
      .legend-row { font-size: 0.9rem; color: #555; display: flex; align-items: center; }
      .legend-row .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; }
      .legend-row .val { font-weight: bold; margin: 0 5px; }
      .legend-row .pct { color: #999; font-size: 0.8rem; }
      
      .assignee-list-card { display: flex; flex-direction: column; height: 100%; }
      .assignee-scroll-container { flex: 1; overflow-y: auto; padding-right: 5px; }
      .assignee-card-v2 .group-name-title { margin: 0; font-size: 1.1rem; }
      .total-task-badge { font-size: 0.8rem; background: #e9ecef; padding: 2px 8px; border-radius: 10px; color: #666; }
      .assignee-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
      .member-progress-item { margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #f1f3f5; }
      .member-progress-item:last-child { border-bottom: none; }
      .group-total-item { background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #e9ecef; }
      .member-info-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
      .member-name { font-weight: 600; font-size: 0.95rem; }
      .member-pos { font-size: 0.8rem; color: #888; font-weight: normal; margin-left: 4px; }
      .member-task-count { font-size: 0.85rem; color: #6c757d; background: white; padding: 1px 6px; border-radius: 10px; border: 1px solid #dee2e6; }
      .progress-info-row { display: flex; justify-content: space-between; font-size: 0.85rem; color: #666; margin-bottom: 4px; }
      .progress-info-row.small { font-size: 0.8rem; }
      .value-pct { font-weight: bold; color: #333; }
      .stacked-progress-bar { height: 10px; background: #e9ecef; border-radius: 5px; overflow: hidden; display: flex; }
      .stacked-progress-bar.thinner { height: 6px; border-radius: 3px; }
      .progress-segment { height: 100%; }
      .progress-segment.completed { background-color: #28a745; }
      .progress-segment.in-progress { background-color: #17a2b8; }
      .progress-segment.delayed { background-color: #ffc107; }

      .member-dashboard-container { display: flex; flex-direction: column; gap: 20px; }
      .motivational-banner { background: linear-gradient(90deg, #4e73df 0%, #224abe 100%); color: white; padding: 20px; border-radius: 10px; display: flex; align-items: center; box-shadow: 0 4px 10px rgba(78, 115, 223, 0.3); }
      .thumb-icon { font-size: 2rem; margin-right: 15px; }
      .kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; }
      .kpi-card { background: white; border-radius: 10px; padding: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; }
      .kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      .kpi-label { font-size: 0.9rem; color: #666; font-weight: 600; }
      .kpi-icon-right { font-size: 1.2rem; opacity: 0.7; }
      .kpi-number { font-size: 2rem; font-weight: bold; color: #333; margin-bottom: 5px; }
      .kpi-sub { font-size: 0.8rem; color: #888; }
      
      .charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
      .legend-dot.plan { background-color: #6f42c1; }
      .legend-dot.actual { background-color: #28a745; }

      .attention-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px; }
      
      .attention-card {
        background: white;
        border-radius: 10px;
        padding: 20px;
        box-shadow: 0 3px 6px rgba(0,0,0,0.05);
        border-left: 4px solid transparent;
        cursor: pointer;
        transition: transform 0.2s, box-shadow 0.2s;
        position: relative;
        overflow: visible;
        margin-top: 10px;
      }
      .attention-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
      .attention-card:nth-child(1) { border-left-color: #f6c23e; } 
      .attention-card:nth-child(2) { border-left-color: #e74a3b; }
      .attention-card:nth-child(3) { border-left-color: #36b9cc; }
      .attention-card:nth-child(4) { border-left-color: #4e73df; }
      
      .att-header { display: flex; align-items: center; margin-bottom: 15px; }
      .att-icon { font-size: 1.4rem; margin-right: 10px; opacity: 0.8; }
      .att-title { font-weight: 700; color: #495057; font-size: 1rem; flex: 1; }
      
      .att-count {
        position: absolute;
        top: -10px;
        right: -10px;
        background-color: #e74a3b;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 0.9rem;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        z-index: 5;
      }

      .att-content { font-size: 0.9rem; color: #555; max-height: 120px; overflow-y: auto; }
      .att-empty { color: #adb5bd; font-style: italic; margin: 0; padding: 10px 0; }
      .att-list { list-style: none; padding: 0; margin: 0; }
      .att-list li { padding: 6px 0; border-bottom: 1px solid #f1f3f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; justify-content: space-between;}
      .att-list li:last-child { border-bottom: none; }
      
      .att-list.issues li { padding: 10px 0; border-bottom: 1px solid #f1f3f5; display: block; }
      .att-issue-row { display: flex; justify-content: space-between; align-items: center; }
      .att-issue-badge { background: #ffe3e3; color: #c92a2a; font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; font-weight: bold; flex-shrink: 0; }
      .att-issue-assignee { font-size: 0.8rem; color: #868e96; margin-top: 2px; }

      .drilldown-banner { background: #333; color: white; padding: 10px 20px; margin-bottom: 15px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }

      .table-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
      .task-table { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); padding: 20px; overflow: hidden; }
      /* Task 상세 현황: 헤더 텍스트가 잘리지 않도록 충분한 최소 너비 확보 */
      .task-table table { width: 100%; min-width: 1600px; border-collapse: collapse; margin-top: 10px; }
      .task-table th, .task-table td { padding: 12px 10px; text-align: left; border-bottom: 1px solid #eee; font-size: 0.9rem; }
      .task-table th { background-color: #f8f9fa; color: #555; font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; position: relative; }
      .task-table th:hover { background-color: #e9ecef; }
      .sort-indicator { margin-left: 5px; font-size: 0.8rem; }
      .sort-priority { font-size: 0.7rem; vertical-align: super; margin-left: 2px; color: #888; }
      
      .status-badge { display: inline-block; padding: 4px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-align: center; min-width: 60px; }
      .status-completed { background-color: #d4edda; color: #155724; }
      .status-progress { background-color: #cce5ff; color: #004085; }
      .status-delayed { background-color: #fff3cd; color: #856404; }
      .status-pending { background-color: #e2e3e5; color: #383d41; }
      
      .issue-icon { background: none; border: none; font-size: 1.1rem; cursor: pointer; position: relative; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
      .issue-icon.add-issue { opacity: 0.2; transition: opacity 0.2s; }
      .issue-icon.add-issue:hover { opacity: 1; content: '💬'; }
      .issue-icon.add-issue::after { content: '+'; font-size: 1.2rem; color: #ccc; }
      .issue-icon:hover { transform: scale(1.1); }
      .unreviewed-issue-count { position: absolute; top: -5px; right: -5px; background: #007bff; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 0.65rem; display: flex; align-items: center; justify-content: center; font-weight: bold; }

      .btn { padding: 8px 16px; border-radius: 4px; border: none; cursor: pointer; font-size: 0.9rem; transition: background 0.2s; display: inline-flex; align-items: center; justify-content: center; }
      .btn-sm { padding: 4px 10px; font-size: 0.8rem; }
      .btn-primary { background-color: #007bff; color: white; }
      .btn-primary:hover { background-color: #0056b3; }
      .btn-secondary { background-color: #6c757d; color: white; }
      .btn-secondary:hover { background-color: #545b62; }
      .btn-success { background-color: #28a745; color: white; }
      .btn-success:hover { background-color: #218838; }
      .btn-danger { background-color: #007bff; color: white; }
      .btn-action { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 4px; border-radius: 4px; transition: background 0.2s; }
      .btn-action:hover { background-color: #f0f0f0; }
      .btn-action.edit { color: #007bff; }
      .btn-action.toggle-active { color: #28a745; opacity: 0.5; }
      .btn-action.toggle-active.active { opacity: 1; }
      .inactive-task { opacity: 0.5; background-color: #f9f9f9; }

      .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: none; align-items: center; justify-content: center; z-index: 10000; }
      .modal.show { display: flex; }
      .modal-content { background: white; padding: 25px; border-radius: 8px; width: 500px; max-width: 90%; max-height: 90vh; overflow-y: auto; position: relative; }
      .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
      .modal-header h3 { margin: 0; font-size: 1.3rem; }
      .modal-close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #aaa; }
      .modal-body { margin-bottom: 20px; }
      .modal-footer { display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 15px; }

      .form-group { margin-bottom: 15px; }
      .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
      .form-label { display: block; margin-bottom: 5px; font-weight: 500; font-size: 0.9rem; color: #555; }
      .form-input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; box-sizing: border-box; }
      .form-input:focus { border-color: #4e73df; outline: none; }
      .form-input:disabled { background-color: #e9ecef; cursor: not-allowed; }

      .login-container { display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f1f3f5; }
      .login-box { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); width: 350px; }
      .login-title { text-align: center; margin-bottom: 30px; color: #004085; font-size: 1.8rem; }
      .login-help { font-size: 0.8rem; color: #888; margin-top: 15px; text-align: center; line-height: 1.5; }

      .notification-container { position: fixed; top: 20px; right: 20px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; }
      .notification { background: white; color: #333; padding: 15px 20px; border-radius: 5px; box-shadow: 0 3px 10px rgba(0,0,0,0.1); animation: slideIn 0.3s ease; display: flex; align-items: center; min-width: 250px; }
      .notification-success { border-left: 5px solid #28a745; }
      .notification-error { border-left: 5px solid #dc3545; }
      @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

      .admin-panel { display: flex; flex-direction: column; gap: 20px; height: 100%; }
      .admin-tabs { display: flex; border-bottom: 1px solid #ddd; margin-bottom: 10px; }
      .admin-tab { padding: 10px 20px; background: none; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-size: 1rem; color: #666; font-weight: 500; }
      .admin-tab:hover { color: #333; }
      .admin-tab.active { border-bottom-color: #007bff; color: #007bff; font-weight: bold; }
      .admin-content { flex: 1; overflow-y: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
      .category-tree { list-style: none; padding-left: 0; }
      .category-tree ul { padding-left: 20px; border-left: 1px dashed #ddd; margin-left: 10px; }
      .category-item { display: flex; align-items: center; padding: 6px 0; }
      .category-name { font-size: 0.95rem; }
      .category-actions { margin-left: 10px; opacity: 0; transition: opacity 0.2s; display: flex; gap: 5px; }
      .category-item:hover .category-actions { opacity: 1; }
      .category-level-1 > .category-item { font-weight: bold; font-size: 1.05rem; margin-top: 10px; color: #333; }
      .category-level-2 > .category-item { font-weight: 500; color: #555; }
      .category-level-3 > .category-item { color: #666; font-size: 0.9rem; }
      .category-input-form { display: flex; gap: 5px; align-items: center; margin: 5px 0 5px 20px; }
      .category-input-form input { padding: 4px 8px; font-size: 0.9rem; border: 1px solid #007bff; border-radius: 4px; width: 150px; }
      .admin-description { font-size: 0.9rem; color: #666; background: #f8f9fa; padding: 10px; border-radius: 4px; margin-bottom: 15px; border-left: 3px solid #17a2b8; }
      .user-mgmt-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      .role-badge { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
      .role-badge.admin { background: #343a40; color: white; }
      .role-badge.dept { background: #2c3e50; color: white; }
      .role-badge.team { background: #007bff; color: white; }
      .role-badge.group { background: #17a2b8; color: white; }
      .role-badge.member { background: #e9ecef; color: #333; }

      .detail-modal .modal-content { max-width: 600px; }
      .detail-item { display: flex; margin-bottom: 12px; border-bottom: 1px solid #f8f9fa; padding-bottom: 8px; }
      .detail-label { width: 120px; font-weight: 600; color: #666; flex-shrink: 0; }
      .detail-value { flex: 1; color: #333; }
      .form-section-header { font-size: 1rem; color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px; margin-top: 20px; margin-bottom: 15px; }

      .sticky-table-layout { display: flex; flex-direction: column; height: calc(100vh - 120px); overflow: hidden; }
      .sticky-control-bar { position: sticky; top: 0; background: white; z-index: 10; padding-bottom: 0; border-bottom: 1px solid #eee; }
      /* ✅ TaskListView 스크롤 자동 조정 금지 */
      .table-responsive { 
        flex: 1; 
        overflow: auto; 
        scroll-behavior: auto !important; 
        overscroll-behavior: contain;
      }
      .table-responsive * { 
        scroll-behavior: auto !important; 
        overscroll-behavior: contain;
      }
      /* TaskListView: 헤더 가운데 정렬 + 스크롤 시 상단 고정 */
      .sticky-thead th { position: sticky; top: 0; z-index: 20; box-shadow: 0 1px 2px rgba(0,0,0,0.1); background: #f8f9fa; text-align: center; vertical-align: middle; }

      .task-search { display: flex; align-items: center; gap: 6px; background: #f1f3f5; border: 1px solid #e9ecef; border-radius: 8px; padding: 4px 8px; height: 32px; }
      /* ✅ 검색 영역 폭 추가 20% 축소(165px -> 132px) */
      .task-search-input { border: none; background: transparent; outline: none; font-size: 0.85rem; min-width: 132px; width: 132px; }
      .task-search-clear { border: none; background: transparent; cursor: pointer; color: #868e96; font-size: 1.05rem; line-height: 1; padding: 0 4px; }
      .task-search-clear:hover { color: #495057; }

      /* TaskListView 상단 컨트롤: 어떤 폭에서도 줄바꿈 금지(세로 이동 방지) */
      .table-controls { flex-wrap: nowrap !important; overflow-x: auto; max-width: 100%; }
      .table-controls > * { flex-shrink: 0; }
      /* 액션 버튼 영역: 기본 폭 10% 축소(약 400px -> 360px) */
      .action-buttons-container { display: flex; gap: 6px; flex-wrap: nowrap; flex-shrink: 0; flex: 0 1 360px; max-width: 360px; }
      .btn.action-btn { padding: 6px 10px; height: 32px; }
      .btn.action-btn .btn-icon { display: inline-flex; }
      @media (max-width: 1200px) {
        .btn.action-btn .btn-text { display: none; }
        .btn.action-btn { padding: 6px 8px; min-width: 32px; }
      }
      /* 더 좁은 화면에서는 영역 자체를 25%까지 축소 */
      @media (max-width: 1400px) {
        .action-buttons-container { flex-basis: 25%; max-width: 25%; }
      }
      .task-search-apply { height: 32px; padding: 0 12px; border-radius: 8px; }
      
      @media (max-width: 768px) {
        .app-layout { flex-direction: column; height: auto; overflow: visible; }
        .sidebar { width: 100%; height: auto; min-height: 60px; }
        .sidebar.collapsed { display: none; }
        .sidebar-header { padding: 20px; display: flex; align-items: center; }
        .mobile-menu-btn { display: block; font-size: 1.5rem; background: none; border: none; cursor: pointer; margin-right: 10px; }
        .main-content { height: auto; overflow: visible; }
        .container { padding: 15px !important; }
        .sticky-header-container { position: sticky !important; top: 0; z-index: 1000; }
        .header { flex-direction: column; align-items: flex-start; gap: 15px; padding: 15px; }
        .header-buttons { width: 100%; display: flex; flex-wrap: wrap; gap: 8px; margin-left: 0; align-items: center; }
        .header-buttons .header-action-btn { height: 36px !important; }
        .view-controls { padding: 15px; gap: 10px; }
        .view-switcher { overflow-x: auto; padding-bottom: 5px; margin-bottom: 0; }
        .view-switcher-btn { white-space: nowrap; flex-shrink: 0; }
        .mobile-filter-toggle-btn { display: block; width: 100%; padding: 10px; background: #e9ecef; border: none; border-radius: 6px; font-weight: 600; color: #495057; cursor: pointer; }
        .filter-wrapper { display: none; flex-direction: column; gap: 15px; background: #f8f9fa; padding: 15px; border-radius: 8px; border: 1px solid #e9ecef; margin-top: 5px; }
        .filter-wrapper.expanded { display: flex; }
        .filter-section { flex-direction: column; align-items: stretch; width: 100%; }
        .date-range-group { flex-direction: column; align-items: stretch; margin-left: 0; width: 100%; }
        .date-input-wrapper { flex-direction: column; align-items: flex-start; }
        .date-input { width: 100%; }
        .group-card-body { flex-direction: column; gap: 30px; }
        .group-stat-section.status, .group-stat-section.trend, .group-stat-section.mbo { width: 100%; flex: auto; }
        .group-dashboard-container { flex-direction: column; }
        .kpi-row, .attention-grid, .charts-row { grid-template-columns: 1fr; }
        .division-dashboard { flex-direction: column; }
        .division-sidebar-panel { width: 100%; margin-bottom: 20px; }
        .task-table { padding: 10px; }
        .task-table table { display: block; overflow-x: auto; white-space: nowrap; }
        .table-controls { flex-direction: column; align-items: stretch !important; gap: 10px; }
        .status-filter-buttons { overflow-x: auto; }
        .task-search { width: 100%; }
        .task-search-input { min-width: 100%; width: 100%; }
        .task-search-apply { width: 100%; }
        .calendar-stats-container { grid-template-columns: 1fr 1fr; }
        .calendar-grid { display: flex; flex-direction: column; }
        .calendar-task { font-size: 0.7rem; padding: 1px 3px; }
        .card-header-row { flex-direction: column; align-items: flex-start; gap: 10px; }
        .card-header-row .card-title { margin-right: 0; margin-bottom: 5px; }
        .chart-header-controls { width: 100%; flex-direction: column; align-items: flex-start; gap: 10px; }
        .chart-filter-buttons { width: 100%; overflow-x: auto; margin-right: 0; }
        .chart-legend-text { width: 100%; justify-content: flex-end; }
      }
    `}</style>
  );

  const [isLogoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  // 저장된 사용자 상태 복원
  const [currentUser, setCurrentUser] = useState<UserContextType>(() => {
    return loadUserFromSession();
  });

  const [data, setData] = useState<SampleData>(() => {
    let migratedData = { ...sampleData };
    migratedData.organization = organizationData;
    // 로컬 저장된 조직(사용자/마스터) 우선 적용
    const ensureHardcodedUsers = (org: Organization): Organization => {
      const newOrg = JSON.parse(JSON.stringify(org)) as Organization;

      // 1) 실장 소병식 (cto/1234) 강제 존재
      const hasCTO = newOrg.departments.some(d =>
        d.teams.some(t =>
          t.groups.some(g => g.members.some(m => (m.loginId || '').toUpperCase() === 'CTO'))
        )
      );
      if (!hasCTO) {
        const dept = newOrg.departments?.[0];
        const team = dept?.teams?.[0];
        const group = team?.groups?.[0];
        if (group) {
          group.members.push({
            id: 'ceo01',
            name: '소병식',
            position: '실장',
            loginId: 'cto',
            password: '1234',
            role: 'dept_head'
          });
        }
      }

      // 2) 이영희 권한을 그룹장으로 강제
      newOrg.departments.forEach(d =>
        d.teams.forEach(t =>
          t.groups.forEach(g =>
            g.members.forEach(m => {
              if (m.name === '이영희') {
                m.role = 'group_leader';
                if (!m.password) m.password = '1234';
              }
            })
          )
        )
      );

      return newOrg;
    };

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedOrg = window.localStorage.getItem(STORAGE_KEYS.organization);
        if (savedOrg) {
          const parsed = JSON.parse(savedOrg);
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.departments)) {
            migratedData.organization = parsed as Organization;
          }
        }
        
        // 저장된 tasks 데이터 로드
        const savedTasks = loadTasksFromLocal();
        if (savedTasks && Array.isArray(savedTasks) && savedTasks.length > 0) {
          migratedData.tasks = savedTasks;
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load saved organization from localStorage:', e);
    }

    // ✅ 로컬 저장본이 있어도 필수 하드코딩 사용자/권한은 보정
    migratedData.organization = ensureHardcodedUsers(migratedData.organization);
    
    // 저장된 tasks가 없으면 샘플 데이터로 마이그레이션
    const tasksToMigrate = migratedData.tasks.length > 0 ? migratedData.tasks : sampleData.tasks;
    const migratedTasks = tasksToMigrate.map(task => {
      const newTask = { ...task };
      // @ts-ignore
      if (newTask.revised) {
        // @ts-ignore
        const revisedPeriod = newTask.revised as Period;
        if (revisedPeriod.startDate !== newTask.planned.startDate || revisedPeriod.endDate !== newTask.planned.endDate || revisedPeriod.hours !== newTask.planned.hours) {
          if (!newTask.revisions || newTask.revisions.length === 0) { newTask.revisions = [{ revisionDate: revisedPeriod.startDate || new Date().toISOString().split('T')[0], reason: '기존 수정된 계획', period: revisedPeriod }]; }
        }
        // @ts-ignore
        delete newTask.revised;
      }
      if (!newTask.revisions) newTask.revisions = [];
      if ((!newTask.dailyLogs || Object.keys(newTask.dailyLogs).length === 0) && hhmmToNumber(newTask.actual.hours) > 0 && newTask.actual.startDate && newTask.actual.endDate) {
        const logs: { [date: string]: string } = {};
        const start = new Date(newTask.actual.startDate);
        const end = new Date(newTask.actual.endDate);
        const totalHours = hhmmToNumber(newTask.actual.hours);
        let dayCount = 0;
        let curr = new Date(start);
        while(curr <= end) { dayCount++; curr.setDate(curr.getDate() + 1); }
        if (dayCount > 0) {
          const hoursPerDay = totalHours / dayCount;
          curr = new Date(start);
          while(curr <= end) {
            logs[curr.toISOString().split('T')[0]] = normalizeHHMM(numberToHHMM(hoursPerDay));
            curr.setDate(curr.getDate() + 1);
          }
        }
        newTask.dailyLogs = logs;
      } else if (!newTask.dailyLogs) {
        newTask.dailyLogs = {};
      }
      return newTask;
    });
    migratedData.tasks = migratedTasks;
    return migratedData;
  });

  // 저장된 UI 상태 복원
  const savedUIState = loadUIStateFromLocal();
  const currentYear = new Date().getFullYear();
  
  const [currentMainView, setCurrentMainView] = useState<'dashboard' | 'taskList' | 'calendar' | 'admin'>(
    savedUIState?.currentMainView || 'dashboard'
  );
  const [currentView, setCurrentView] = useState<ViewType>(
    savedUIState?.currentView || 'department'
  );
  const [filters, setFilters] = useState(
    savedUIState?.filters || { team: 'team1', group: 'group1', member: 'emp01' }
  );
  const [filterStartMonth, setFilterStartMonth] = useState(
    savedUIState?.filterStartMonth || `${currentYear}-01`
  );
  const [filterEndMonth, setFilterEndMonth] = useState(
    savedUIState?.filterEndMonth || `${currentYear}-12`
  );
  const [drillDownIds, setDrillDownIds] = useState<Set<string> | null>(null);
  const [statusFilter, setStatusFilter] = useState(savedUIState?.statusFilter || '');
  const [sortConfig, setSortConfig] = useState<SortConfig[]>(savedUIState?.sortConfig || []);
  const [showInactive, setShowInactive] = useState(savedUIState?.showInactive || false);
  const [excludeCompleted, setExcludeCompleted] = useState(savedUIState?.excludeCompleted || false);
  // 검색은 입력(로컬) 후 '조회'에서 적용(taskSearchQuery)
  const [taskSearchQuery, setTaskSearchQuery] = useState(savedUIState?.taskSearchQuery || '');
  // ✅ Task 목록 테이블 컬럼 넓이: 정렬/리렌더 시 초기화 방지 (App 레벨로 승격)
  // (비활성화 컬럼 + Task Code 컬럼 분리로 1칸 추가)
  // ✅ 헤더 텍스트가 잘리지 않도록 기본 폭 재조정 (합계 100)
  const [taskTableColumnWidths, setTaskTableColumnWidths] = useState<number[]>(
    savedUIState?.taskTableColumnWidths || [3, 5, 9, 9, 8, 15, 7, 7, 7, 5, 6, 5, 4, 10]
  );
  const [calendarDate, setCalendarDate] = useState(
    savedUIState?.calendarDate ? new Date(savedUIState.calendarDate) : new Date()
  );
  const [isTaskModalOpen, setTaskModalOpen] = useState(false);
  const [isUploadModalOpen, setUploadModalOpen] = useState(false);
  const [isIssueModalOpen, setIssueModalOpen] = useState(false);
  const [isEditModalOpen, setEditModalOpen] = useState(false);
  const [isDetailModalOpen, setDetailModalOpen] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [integratedUploadStatusLines, setIntegratedUploadStatusLines] = useState<string[]>([]);
  const [integratedUploadErrorReasons, setIntegratedUploadErrorReasons] = useState<string[]>([]);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [errorModalTitle, setErrorModalTitle] = useState('엑셀 업로드 오류');
  const [isRevisionModalOpen, setRevisionModalOpen] = useState(false);
  const [selectedTaskForIssues, setSelectedTaskForIssues] = useState<Task | null>(null);
  const [selectedTaskForEdit, setSelectedTaskForEdit] = useState<Task | null>(null);
  const [selectedTaskForDetail, setSelectedTaskForDetail] = useState<Task | null>(null);
  const [selectedTaskForRevision, setSelectedTaskForRevision] = useState<Task | null>(null);
  const [isDailyModalOpen, setDailyModalOpen] = useState(false);
  const [uploadType, setUploadType] = useState<'full' | 'hours' | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    savedUIState?.isSidebarCollapsed || false
  );
  const [hasShownSetupError, setHasShownSetupError] = useState(false);

  // ... (App 컴포넌트 내부)

  // 사용자 로그인 상태 저장 래퍼
  const handleUserLogin = useCallback((user: UserContextType) => {
    setCurrentUser(user);
    saveUserToSession(user);
  }, []);

  // tasks 데이터 변경 시 자동 저장
  useEffect(() => {
    if (data.tasks && data.tasks.length > 0) {
      saveTasksToLocal(data.tasks);
    }
  }, [data.tasks]);

  const handleLogoutConfirm = () => {
    setCurrentUser(null);
    saveUserToSession(null);
    
    // [추가] 로그아웃 시 화면 상태를 '대시보드 > 실(Department)' 뷰로 초기화
    setCurrentMainView('dashboard');
    setCurrentView('department');
    
    // (선택 사항) 드릴다운 상태 등도 함께 초기화하면 더 깔끔합니다.
    setDrillDownIds(null);

    setLogoutConfirmOpen(false);
  };

  // ...

  const getTeamMembers = useCallback((teamId: string) => { const team = data.organization.departments[0].teams.find(t => t.id === teamId); return team ? team.groups.flatMap(g => g.members.map(m => m.id)) : []; }, [data.organization]);
  const getGroupMembers = useCallback((teamId: string, groupId: string) => { const team = data.organization.departments[0].teams.find(t => t.id === teamId); const group = team ? team.groups.find(g => g.id === groupId) : null; return group ? group.members.map(m => m.id) : []; }, [data.organization]);
  const getMemberInfo = useCallback((memberId: string) => {
    for (const dept of data.organization.departments) {
      for (const team of dept.teams) {
        for (const group of team.groups) {
          const member = group.members.find(m => m.id === memberId);
          if (member) {
            return {
              ...member,
              group: group.name,
              team: team.name,
              department: dept.name,
              teamId: team.id,
              groupId: group.id,
              departmentId: dept.id
            };
          }
        }
      }
    }
    return null;
  }, [data.organization]);
  const addNotification = (message: string, type: 'success' | 'error' = 'success') => { 
    const id = Date.now() + Math.random(); 
    setNotifications(prev => [...prev, { id, message, type }]); 
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  };

  const openBlockingErrorModal = useCallback((title: string, errors: string[]) => {
    // 다른 맥락의 모달을 열 때 통합 업로드 섹션 데이터는 초기화
    setIntegratedUploadStatusLines([]);
    setIntegratedUploadErrorReasons([]);
    setUploadErrors(errors);
    setErrorModalTitle(title);
    setIsErrorModalOpen(true);
  }, []);

  const getSetupMissingReasons = useCallback(() => {
    const reasons: string[] = [];
    const allMembers = data.organization.departments.flatMap(d =>
      d.teams.flatMap(t => t.groups.flatMap(g => g.members))
    );
    if (allMembers.length === 0) reasons.push('사용자 관리가 등록되지 않았습니다. (사용자_관리)');
    const catMaster = data.organization.departments[0]?.teams[0]?.categoryMaster;
    if (!catMaster || Object.keys(catMaster).length === 0) reasons.push('업무 구분이 등록되지 않았습니다. (업무_구분)');
    const obsMaster = data.organization.departments[0]?.teams[0]?.obsMaster;
    if (!obsMaster || Object.keys(obsMaster).length === 0) reasons.push('OBS 관리가 등록되지 않았습니다. (OBS_관리)');
    if (!data.tasks || data.tasks.length === 0) reasons.push('Task 등록이 되어있지 않습니다. (Task 관리)');
    return reasons;
  }, [data.organization, data.tasks]);
  
  useEffect(() => {
    if (currentUser) {
      setFilters(prev => {
        let newFilters = { ...prev };
        let changed = false;
        if (currentUser.role !== 'admin' && currentUser.teamId) {
          if (newFilters.team !== currentUser.teamId) { newFilters.team = currentUser.teamId; changed = true; }
        }
        if ((currentUser.role === 'group_leader' || currentUser.role === 'member') && currentUser.groupId) {
          if (newFilters.group !== currentUser.groupId) { newFilters.group = currentUser.groupId; changed = true; }
        }
        if (currentUser.role === 'member') {
          if (newFilters.member !== currentUser.id) { newFilters.member = currentUser.id; changed = true; }
        }
        return changed ? newFilters : prev;
      });
    }
  }, [currentUser]);

  // 로그인 직후: 접속자 권한/직책에 맞는 대시보드 뷰로 자동 진입
  useEffect(() => {
    if (!currentUser) return;

    // 항상 대시보드부터 시작 (요구사항)
    setCurrentMainView('dashboard');
    setDrillDownIds(null);

    const isDirector =
      currentUser.role === 'dept_head' ||
      (typeof currentUser.position === 'string' && currentUser.position.includes('실장'));
    const nextView: ViewType =
      (currentUser.role === 'admin' || isDirector)
        ? 'department'
        : currentUser.role === 'team_leader'
          ? 'team'
          : currentUser.role === 'group_leader'
            ? 'group'
            : 'member';

    setCurrentView(nextView);
  }, [currentUser]);

  // 필수 등록 누락 시 단일 에러 알림 모달(바깥 클릭으로 닫힘 없음)
  useEffect(() => {
    if (!currentUser) return;
    if (hasShownSetupError) return;
    const reasons = getSetupMissingReasons();
    if (reasons.length > 0) {
      openBlockingErrorModal('필수 등록 누락', reasons);
      setHasShownSetupError(true);
    }
  }, [currentUser, hasShownSetupError, getSetupMissingReasons, openBlockingErrorModal]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => { const { id, value } = e.target; if (id === 'teamSelect') { const team = data.organization.departments[0].teams.find(t => t.id === value); if (team) { const group = team.groups[0]; const member = group?.members[0]; setFilters({ team: value, group: group?.id || '', member: member?.id || '' }); } } else if (id === 'groupSelect') { const team = data.organization.departments[0].teams.find(t => t.id === filters.team); const group = team?.groups.find(g => g.id === value); const member = group?.members[0]; setFilters(prev => ({ ...prev, group: value, member: member?.id || '' })); } else if (id === 'memberSelect') { setFilters(prev => ({ ...prev, member: value })); } };
  const handleExcludeCompletedChange = (e: React.ChangeEvent<HTMLInputElement>) => { setExcludeCompleted(e.target.checked); };
  // ... (기존 State 및 로직 유지) ...
  // [중요] handleToggleActive 함수 수정/확인
  const getTeamNameById = useCallback((teamId?: string) => {
    if (!teamId) return null;
    for (const dept of data.organization.departments) {
      const team = dept.teams.find(t => t.id === teamId);
      if (team) return team.name;
    }
    return null;
  }, [data.organization]);

  const getGroupNameById = useCallback((groupId?: string) => {
    if (!groupId) return null;
    for (const dept of data.organization.departments) {
      for (const team of dept.teams) {
        const group = team.groups.find(g => g.id === groupId);
        if (group) return group.name;
      }
    }
    return null;
  }, [data.organization]);

  const canEditTaskForUser = useCallback((task: Task) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (currentUser.role === 'dept_head') {
      const myDeptName = currentUser.departmentId
        ? data.organization.departments.find(d => d.id === currentUser.departmentId)?.name
        : null;
      return !!myDeptName && task.department === myDeptName;
    }
    if (currentUser.role === 'team_leader') {
      const myTeamName = getTeamNameById(currentUser.teamId);
      return !!myTeamName && task.team === myTeamName;
    }
    if (currentUser.role === 'group_leader') {
      const myGroupName = getGroupNameById(currentUser.groupId);
      return !!myGroupName && task.group === myGroupName;
    }
    return task.assignee === currentUser.id;
  }, [currentUser, data.organization.departments, getTeamNameById, getGroupNameById]);

  const canToggleActiveForUser = useCallback((task: Task) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (currentUser.role === 'dept_head') {
      const myDeptName = currentUser.departmentId
        ? data.organization.departments.find(d => d.id === currentUser.departmentId)?.name
        : null;
      return !!myDeptName && task.department === myDeptName;
    }
    if (currentUser.role === 'team_leader') {
      const myTeamName = getTeamNameById(currentUser.teamId);
      return !!myTeamName && task.team === myTeamName;
    }
    if (currentUser.role === 'group_leader') {
      const myGroupName = getGroupNameById(currentUser.groupId);
      return !!myGroupName && task.group === myGroupName;
    }
    return false;
  }, [currentUser, data.organization.departments, getTeamNameById, getGroupNameById]);

  const handleToggleActive = (taskId: string, currentActive: boolean) => {
    const target = data.tasks.find(t => t.id === taskId);
    if (!target) return;
    if (!canToggleActiveForUser(target)) {
      addNotification('숨김/활성 변경 권한이 없습니다.', 'error');
      return;
    }

    const nextActive = !currentActive;
    const regLabel = getTaskRegistrationLabel(target);
    const todayStr = new Date().toISOString().split('T')[0];
    const updatedTasks = data.tasks.map(t => {
      if (t.id !== taskId) return t;
      const updatedIssues = [
        ...(t.monthlyIssues || []),
        {
          date: todayStr,
          issue: `[Task 관리][${regLabel}] ${nextActive ? '활성화' : '비활성화'} 처리`,
          author: 'System',
          reviewed: false,
          replies: []
        }
      ];
      return { ...t, isActive: nextActive, monthlyIssues: updatedIssues };
    });
    setData({ ...data, tasks: updatedTasks });
    addNotification(`Task가 ${nextActive ? '활성화' : '숨김(비활성)'} 처리되었습니다.`);
    
    // 상세 모달이 열려 있다면 상태 동기화 (선택적)
    if (selectedTaskForDetail && selectedTaskForDetail.id === taskId) {
      setSelectedTaskForDetail({ ...selectedTaskForDetail, isActive: nextActive });
    }
  };

  const handleEdit = (task: Task) => {
    if (!canEditTaskForUser(task)) {
      addNotification('수정 권한이 없습니다.', 'error');
      return;
    }
    // 상태 업데이트를 지연시켜 스크롤 복원이 먼저 실행되도록 함
    requestAnimationFrame(() => {
      setSelectedTaskForEdit(task);
      setEditModalOpen(true);
    });
  };
  const handleOpenDetailModal = (task: Task) => { setSelectedTaskForDetail(task); setDetailModalOpen(true); };
  const handleUpdateData = (newData: SampleData) => { setData(newData); };
  const handleDrillDown = useCallback((targetTasks: Task[]) => { if (targetTasks.length === 0) { addNotification('해당하는 Task가 없습니다.', 'error'); return; } setDrillDownIds(new Set(targetTasks.map(t => t.id))); setCurrentMainView('taskList'); }, []);
    // [수정] 표준양식 다운로드 (스타일 미지원 시 텍스트로 구분하는 버전)
  //2601081221
  //2
  // [수정] 표준양식 다운로드 (중요도 컬럼 제거 버전)
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    const getRegistrationLabelForExcel = (task: Task) => {
      if (task.registration && String(task.registration).trim()) return task.registration;
      const createdVia = task.createdVia ?? 'unknown';
      if (createdVia === 'manual') return '추가';
      const createdByRole = task.createdByRole ?? 'admin';
      if (createdByRole !== 'admin') return '추가';
      const revisionCount = task.revisions ? task.revisions.length : 0;
      return `R.${revisionCount}`;
    };

    // 0. 주의사항 시트 (템플릿별 입력 규칙) - ✅ 가장 앞에 위치
    const noticeWsData = [
      ['표준양식 입력 주의사항'],
      [''],
      ['[Task 관리]'],
      ['- 상단 안내(1~3행)는 수정하지 마세요.'],
      ['- 4행이 헤더이며, 5행부터 데이터를 입력/붙여넣기 하세요.'],
      ['- 날짜 형식: YYYY-MM-DD'],
      ['- Task Code(속성정의): 실-팀-그룹-업무구분1(NN)-업무구분2(NN)-Task1(NN)-Task2(NN)'],
      ['  예시: DI-AI-NLP-PL01.02.04.01'],
      ['- 신규 Task 입력시 Task Code 비워둡니다.'],
      ['- Task Code 는 절대 중복 될수 없습니다.'],
      ['- MH 형식: hh.mm (mm은 00~60)'],
      ['- ⚠ 업로드 제외 컬럼: 진척률, 비활성화 여부, 이슈 및 해결방안, 관리자 검토의견은 업로드로 반영되지 않습니다.'],
      ['- 템플릿 업로드로 계획/실적이 변경되면 등록구분(R.#/NR.#)이 1씩 증가하며, 변경 내용은 이슈 관리에 자동 기록됩니다.'],
      [''],
      ['[업무_구분 / OBS_Master_Data]'],
      ['- 신규 등록시 코드는 비워둡니다.'],
      [''],
      ['[조직_관리]'],
      ['- "*" 표시는 필수 입력입니다.'],
      ['- 코드는 자동 생성되며, 수동 입력도 가능합니다.'],
      ['- Lv.1 코드는 전체 조직에서 고유해야 합니다.'],
      ['- Lv.2 코드는 같은 Lv.1 내에서 고유해야 합니다.'],
      ['- Lv.3 코드는 같은 Lv.2 내에서 고유해야 합니다.'],
      ['- 빈 행은 무시됩니다.'],
      [''],
      ['[사용자_관리]'],
      ['- "*" 표시는 필수 입력입니다.'],
      ['- 권한 값: 관리자 /실장 / 팀장 / 그룹장 / 팀원'],
      ['- 실(Department)은 항상 정확히 입력해야 합니다.'],
      ['- 권한이 "실장"이 포함된 경우: 팀, 그룹은 "-" 로 입력하세요. (시스템이 자동으로 소속을 배치합니다)'],
      ['- 권한이 "팀장"인 경우: 그룹은 "-" 로 입력하세요. (시스템이 선택한 팀의 첫 그룹으로 자동 배치합니다)'],
      ['- ID는 중복될 수 없습니다.'],
    ];
    const noticeWs = XLSX.utils.aoa_to_sheet(noticeWsData);
    noticeWs['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, noticeWs, "주의사항");

    // 1. Task 관리 템플릿 시트 (내보내기 형식과 동일)
    const taskWsData = [
      ["Task 목록 내보내기 데이터 (시스템 생성)"],
      ["'*' 표시는 필수 관리 항목입니다."],
      [],
      [
        "Task ID", "*실", "*팀", "*그룹", "*담당자",
        "Task Code",
        "업무구분 1 Code", "*업무구분 1",
        "업무구분 2 Code", "*업무구분 2",
        "Task 1 Code", "Task 1",
        "Task 2 Code", "*Task 2",
        "*계획(시작일)", "*계획(종료일)", "실적(시작일)", "실적(종료일)",
        "*계획MH\n(hh.mm, mm:00~60)", "실적MH\n(hh.mm, mm:00~60)",
        "진척률", "진행상태", "이슈 및 해결방안", "관리자 검토의견",
        "등록구분",
        "비활성화 여부"
      ]
    ];
    
    // 현재 Task 목록 데이터 추가 (내보내기 형식과 동일)
    const statusMap: Record<string, string> = { 
      'not-started': '미시작', 
      'in-progress': '진행중', 
      'delayed': '지연', 
      'completed': '완료' 
    };
    
    const adminCategoryMaster = data.organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
    const formatTaskCodeForExcel = (code: string) => {
      const raw = String(code || '').trim();
      const m = raw.match(/^([^-]+-[^-]+-[^-]+)-([A-Za-z0-9]+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (!m) return raw;
      const [, org, cat1, a, b, c] = m;
      const aN = parseInt(a, 10), bN = parseInt(b, 10), cN = parseInt(c, 10);
      if ([aN, bN, cN].some(x => Number.isNaN(x))) return raw;
      const pad2 = (n: number) => String(n).padStart(2, '0');
      return `${org}-${cat1}.${pad2(aN)}.${pad2(bN)}.${pad2(cN)}`;
    };
    const getCategory1CodeForExcel = (category1: string) => {
      if (!category1) return '';
      const mapped = (categoryCodeMapping.category1 as any)[category1];
      if (mapped) return mapped;
      const m = category1.match(/\(([^)]+)\)\s*$/);
      if (m?.[1]) return m[1].trim();
      const stripped = category1.replace(/\s*\([^)]*\)\s*$/, '').trim();
      return (categoryCodeMapping.category1 as any)[stripped] || '';
    };
    const getCategory2CodeForExcel = (category1: string, category2: string) => {
      if (!category1 || !category2) return '';
      const cat1Data = adminCategoryMaster[category1] || {};
      const idx = Object.keys(cat1Data).indexOf(category2);
      return idx >= 0 ? String(idx + 1).padStart(2, '0') : '';
    };
    const getTask1CodeForExcel = (category1: string, category2: string, category3: string) => {
      if (!category1 || !category2 || !category3) return '';
      const cat1Data = adminCategoryMaster[category1] || {};
      const cat3List = cat1Data[category2] || [];
      const idx = Array.isArray(cat3List) ? cat3List.indexOf(category3) : -1;
      return idx >= 0 ? String(idx + 1).padStart(2, '0') : '';
    };
    const getTask2CodeForExcel = (taskCode: string) => {
      const parts = String(taskCode || '').split('.');
      const last = parts[parts.length - 1] || '';
      const n = parseInt(last, 10);
      if (Number.isNaN(n)) return '';
      return String(n).padStart(2, '0');
    };
    const getInactiveLabelForExcel = (task: Task) => (task.isActive === false ? 'Y' : 'N');

    data.tasks.forEach(task => {
      const currentPlan = getCurrentPlan(task);
      const planHours = currentPlan.hours || '00.00';
      const actualHours = task.actual.hours || '00.00';
      const planHoursNum = hhmmToNumber(planHours);
      const actualHoursNum = hhmmToNumber(actualHours);
      const progressRate = planHoursNum > 0 ? Math.round((actualHoursNum / planHoursNum) * 100) : 0;
      
      const latestIssue = task.monthlyIssues && task.monthlyIssues.length > 0 
        ? task.monthlyIssues[task.monthlyIssues.length - 1].issue 
        : '';
      const reviewOpinion = task.monthlyIssues && task.monthlyIssues.length > 0 
        ? task.monthlyIssues.find(issue => issue.replies && issue.replies.length > 0)?.replies?.[0]?.text || ''
        : '';
      
      taskWsData.push([
        task.id,
        task.department || '',
        task.team || '',
        task.group || '',
        task.assigneeName || '',
        formatTaskCodeForExcel(task.taskCode || ''), // Task Code (visible)
        getCategory1CodeForExcel(task.category1) || '', // 업무구분 1 code
        task.category1 || '',
        getCategory2CodeForExcel(task.category1, task.category2) || '', // 업무구분 code
        task.category2 || '',
        getTask1CodeForExcel(task.category1, task.category2, task.category3) || '', // Task 1 Code
        task.category3 || '', // Task 1
        getTask2CodeForExcel(task.taskCode) || '', // Task 2 Code (hidden)
        task.name || '',
        currentPlan.startDate || '',
        currentPlan.endDate || '',
        task.actual.startDate || '',
        task.actual.endDate || '',
        planHours,
        actualHours,
        `${progressRate}%`,
        statusMap[task.status] || '미시작',
        latestIssue,
        reviewOpinion,
        getRegistrationLabelForExcel(task),
        getInactiveLabelForExcel(task)
      ]);
    });
    
    // 데이터가 없으면 샘플 데이터 추가
    if (data.tasks.length === 0) {
      taskWsData.push([
        "AAA-S01.2-H01.01.01", "ENG혁신실", "AI개발팀", "자연어처리그룹", "김철수",
        "DI-AI-NLP-PL01.02.04.01",
        "A01", "연구개발",
        "01", "GPT모델",
        "01", "파인튜닝",
        "01", "프로세스 구체화 (샘플)",
        "2024-11-06", "2024-12-03", "", "",
        "160.00", "00.00", "0%", "지연", "", "", "R.0"
        , "N"
      ]);
    }
    const taskWs = XLSX.utils.aoa_to_sheet(taskWsData);
    // ✅ 모든 "코드" 컬럼 + 날짜/MH 컬럼을 텍스트로 고정
    // - Task Code / 업무구분 Code / Task Code(hidden) 등
    // - 날짜/시수는 표시/입력 일관성을 위해 텍스트 고정
    setTextFormatForColumns(taskWs, [5, 6, 8, 10, 12, 14, 15, 18, 19], { ensureRows: 1000 });
    taskWs['!cols'] = [
      { wch: 20, hidden: true }, // Task ID (숨김)
      { wch: 10 },               // *실
      { wch: 10 },               // *팀
      { wch: 15 },               // *그룹
      { wch: 10 },               // *담당자
      { wch: 20 },               // Task Code (표시)
      { wch: 15, hidden: true }, // 업무구분 1 Code (숨김)
      { wch: 15 },               // *업무구분 1
      { wch: 15, hidden: true }, // 업무구분 2 Code (숨김)
      { wch: 15 },               // *업무구분 2
      { wch: 15, hidden: true }, // Task 1 Code (숨김)
      { wch: 15 },               // Task 1
      { wch: 15, hidden: true }, // Task 2 Code (숨김)
      { wch: 35 },               // *Task 2
      { wch: 12 },               // *계획(시작일) YYYY-MM-DD
      { wch: 12 },               // *계획(종료일) YYYY-MM-DD
      { wch: 12 },               // 실적(시작일)
      { wch: 12 },               // 실적(종료일)
      { wch: 12 },               // *계획MH (hh.mm)
      { wch: 12 },               // 실적MH (hh.mm)
      { wch: 8 },                // 진척률
      { wch: 10 },               // 진행상태
      { wch: 30 },               // 이슈 및 해결방안
      { wch: 20 },               // 관리자 검토의견
      { wch: 10 },               // 등록구분
      { wch: 12 }                // 비활성화 여부
    ];
    taskWs['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 25 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 25 } }
    ];
    XLSX.utils.book_append_sheet(wb, taskWs, "Task 관리");

    // 2. 업무 구분 템플릿 시트
    const categoryWsData = [['Lv1 코드', '*Lv1 명칭', 'Lv2 코드', '*Lv2 명칭', 'Lv3 코드', '*Lv3 명칭']];
    const activeCategoryData = data.organization.departments[0]?.teams[0]?.categoryMaster || {};
    Object.keys(activeCategoryData).forEach(cat1Name => {
      const cat1Code = categoryCodeMapping.category1[cat1Name] || '';
      const cat2Obj = activeCategoryData[cat1Name];
      Object.keys(cat2Obj).forEach((cat2Name, idx2) => {
        const cat2Code = String(idx2 + 1).padStart(2, '0');
        const cat3List = cat2Obj[cat2Name] || [];
        if (cat3List.length > 0) {
          cat3List.forEach((cat3Name: string, idx3: number) => {
            categoryWsData.push([
              cat1Code,
              cat1Name,
              cat2Code,
              cat2Name,
              String(idx3 + 1).padStart(2, '0'),
              cat3Name
            ]);
          });
        } else {
          categoryWsData.push([cat1Code, cat1Name, cat2Code, cat2Name, '', '']);
        }
      });
    });
    if (categoryWsData.length === 1) {
      categoryWsData.push(['A01', '연구개발', '01', 'GPT모델', '01', '파인튜닝']);
    }
    const categoryWs = XLSX.utils.aoa_to_sheet(categoryWsData);
    // ✅ 코드 컬럼 텍스트 고정 (Lv1/Lv2/Lv3 코드)
    setTextFormatForColumns(categoryWs, [0, 2, 4], { ensureRows: 1000 });
    categoryWs['!cols'] = [{ wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, categoryWs, "업무_구분");

    // 3. OBS 관리 템플릿 시트
    const obsWsData = [['Lv.1 코드', '*Lv1 명칭', 'Lv.2 코드', '*Lv2 명칭', 'Lv.3 코드', '*Lv3 명칭']];
    const activeOBSData = data.organization.departments[0]?.teams[0]?.obsMaster || {};
    
    // OBS 코드 생성 헬퍼 함수 (로컬) - 조직 관리 화면 코드 기반
    const generateOBSCodeForTemplate = (lv1: string, lv2: string, lv3: string) => {
      const lv1Code = obsCodeMapping.lv1[lv1 as keyof typeof obsCodeMapping.lv1] || '';
      // Lv.2 코드: 조직 관리 화면에서 설정한 팀 코드 사용
      let lv2Code = '';
      if (lv2) {
        let found = false;
        for (const dept of data.organization.departments) {
          for (let teamIdx = 0; teamIdx < dept.teams.length; teamIdx++) {
            const team = dept.teams[teamIdx];
            if (team.name === lv2) {
              // 조직 관리에서 설정한 코드 우선 사용, 없으면 인덱스 기반 생성
              lv2Code = (team as any).code || String(teamIdx + 1).padStart(2, '0');
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      let lv3Code = '';
      if (lv3) {
        const categoryMaster = data.organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
        outerLoop:
        for (const cat1Key of Object.keys(categoryMaster)) {
          const cat2Obj = categoryMaster[cat1Key];
          for (const cat2Key of Object.keys(cat2Obj)) {
            const cat3Array = cat2Obj[cat2Key];
            if (Array.isArray(cat3Array) && cat3Array.includes(lv3)) {
              const cat1Code = (categoryCodeMapping.category1 as any)[cat1Key.split(' (')[0]] || '';
              const cat2Index = Object.keys(cat2Obj).indexOf(cat2Key) + 1;
              const cat3Index = cat3Array.indexOf(lv3) + 1;
              lv3Code = `${cat1Code}.${String(cat2Index).padStart(2, '0')}.${String(cat3Index).padStart(2, '0')}`;
              break outerLoop;
            }
          }
        }
      }
      return { lv1Code, lv2Code, lv3Code };
    };
    
    Object.keys(activeOBSData).forEach(lv1 => {
      const lv2Obj = activeOBSData[lv1];
      Object.keys(lv2Obj).forEach(lv2 => {
        const lv3List = lv2Obj[lv2] || [];
        if (lv3List.length > 0) {
          lv3List.forEach((lv3: string) => {
            const codes = generateOBSCodeForTemplate(lv1, lv2, lv3);
            obsWsData.push([codes.lv1Code, lv1, codes.lv2Code, lv2, codes.lv3Code, lv3]);
          });
        } else {
          const codes = generateOBSCodeForTemplate(lv1, lv2, '');
          obsWsData.push([codes.lv1Code, lv1, codes.lv2Code, lv2, '', '']);
        }
      });
    });
    if (obsWsData.length === 1) {
      obsWsData.push(['O01', '1. 중점과제', '', '팀명 예시', '', '업무 구분 예시']);
    }
    const obsWs = XLSX.utils.aoa_to_sheet(obsWsData);
    // ✅ 코드 컬럼 텍스트 고정 (Lv1/Lv2/Lv3 코드)
    setTextFormatForColumns(obsWs, [0, 2, 4], { ensureRows: 1000 });
    // ✅ 코드 열(0,2,4) 숨김 처리
    obsWs['!cols'] = [
      { wch: 10, hidden: true }, // Lv.1 코드
      { wch: 25 },               // Lv1 명칭
      { wch: 10, hidden: true }, // Lv.2 코드
      { wch: 30 },               // Lv2 명칭
      { wch: 10, hidden: true }, // Lv.3 코드
      { wch: 35 }                // Lv3 명칭
    ];
    // ✅ 표준양식 다운로드: OBS_관리 시트는 제거하고, "OBS_Master_Data" 시트명으로만 제공
    XLSX.utils.book_append_sheet(wb, obsWs, "OBS_Master_Data");

    // 4. 조직 관리 템플릿 시트
    const orgWsData = [['Lv.1 코드', '*Lv.1 실', 'Lv.2 코드', '*Lv.2 팀', 'Lv.3 코드', '*Lv.3 그룹']];
    // 현재 조직 데이터를 평탄화하여 엑셀 데이터로 변환
    data.organization.departments.forEach((dept, deptIdx) => {
      const deptCode = (dept as any).code || String(deptIdx + 1).padStart(2, '0');
      
      if (dept.teams.length === 0) {
        // 실만 있고 팀이 없는 경우
        orgWsData.push([deptCode, dept.name, '', '', '', '']);
      } else {
        dept.teams.forEach((team, teamIdx) => {
          const teamCode = (team as any).code || String(teamIdx + 1).padStart(2, '0');
          
          if (team.groups.length === 0) {
            // 팀만 있고 그룹이 없는 경우
            orgWsData.push([deptCode, dept.name, teamCode, team.name, '', '']);
          } else {
            // 그룹이 있는 경우
            team.groups.forEach((group, groupIdx) => {
              const groupCode = (group as any).code || String(groupIdx + 1).padStart(2, '0');
              orgWsData.push([deptCode, dept.name, teamCode, team.name, groupCode, group.name]);
            });
          }
        });
      }
    });
    const orgWs = XLSX.utils.aoa_to_sheet(orgWsData);
    setTextFormatForColumns(orgWs, [1, 3, 5], { ensureRows: 1000 });
    orgWs['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, orgWs, "조직_관리");

    // 5. 사용자 관리 템플릿 시트
    const userWsData = [['*이름', '*ID', '*비밀번호', '*실', '*팀', '*그룹', '직책', '*권한']];
    const allMembers = data.organization.departments.flatMap(d => 
      d.teams.flatMap(t => 
        t.groups.flatMap(g => 
          g.members.map(m => ({ ...m, deptName: d.name, teamName: t.name, groupName: g.name }))
        )
      )
    );
    allMembers.forEach(member => {
      userWsData.push([
        member.name,
        member.loginId,
        member.password || '',
        member.deptName,
        member.teamName,
        member.groupName,
        member.position,
        (member.role === 'dept_head' || member.position?.includes('실장'))
          ? '실장'
          : member.role === 'admin'
            ? '관리자'
            : member.role === 'team_leader'
              ? '팀장'
              : member.role === 'group_leader'
                ? '그룹장'
                : '팀원'
      ]);
    });
    if (userWsData.length === 1) {
      userWsData.push(['홍길동', 'hong', '123', 'ENG혁신실', 'AI개발팀', '자연어처리그룹', '선임연구원', '팀원']);
    }
    const userWs = XLSX.utils.aoa_to_sheet(userWsData);
    // ✅ 사용자 ID도 텍스트 고정 (선행 0 등 보존)
    setTextFormatForColumns(userWs, [1], { ensureRows: 1000 });
    userWs['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, userWs, "사용자_관리");

    // 파일 내보내기
    XLSX.writeFile(wb, "표준양식_모음.xlsx");
  };
  //2
  //2601081221

  // -----------------------------------------------------------------------------
  // Task 관리 시트: 헤더 기반 컬럼 인덱스 해석 (템플릿 버전 변경 호환)
  // -----------------------------------------------------------------------------
  const resolveTaskSheetColumnMap = (headerRow: any[] | undefined, sampleRow?: any[]) => {
    const norm = (v: any) => String(v ?? '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/\*/g, '')
      .replace(/\./g, '');

    const headers = Array.isArray(headerRow) ? headerRow.map(norm) : [];
    const findBy = (predicate: (h: string) => boolean) => {
      if (headers.length === 0) return -1;
      return headers.findIndex(predicate);
    };
    const findText = (key: string) => {
      const k = norm(key);
      return findBy(h => h === k || h.includes(k));
    };
    const findValueColumn = (baseKey: string) => {
      const k = norm(baseKey);
      return findBy(h => (h === k || h.includes(k)) && !h.includes('code'));
    };
    const findCodeColumn = (baseKey: string) => {
      const k = norm(baseKey);
      return findBy(h => (h === k || h.includes(k)) && h.includes('code'));
    };

    // ✅ 신규 템플릿 기본 인덱스 (Task 관리)
    const fallbackNew = {
      assignee: 4,   // *담당자
      task2: 13,     // *Task 2
      taskCode: 5,   // Task Code
      category1: 7,  // *업무구분 1
      category2: 9,  // *업무구분 2
      category3: 11, // Task 1
      planStart: 14,
      planEnd: 15,
      actualStart: 16,
      actualEnd: 17,
      planMH: 18,
      actualMH: 19,
      status: 21,    // 진행상태
      issue: 22,     // 이슈 및 해결방안
      review: 23,    // 관리자 검토의견
      inactive: 25,  // 비활성화 여부 (마지막 열)
    };

    // ✅ 구 템플릿 기본 인덱스 (Task_등록 / 기존 내보내기)
    const fallbackOld = {
      assignee: 4,
      task2: 12,
      taskCode: 11,
      category1: 6,
      category2: 8,
      category3: 10,
      planStart: 13,
      planEnd: 14,
      actualStart: 15,
      actualEnd: 16,
      planMH: 17,
      actualMH: 18,
      status: 20,
      issue: 21,
      review: 22,
      inactive: -1,
    };

    // 헤더가 있으면 우선 헤더로 찾고, 없으면 row 길이로 추정
    const isLikelyNew = headers.length > 0
      ? ((findValueColumn('task1') >= 0 && findCodeColumn('task2') >= 0) || (findCodeColumn('업무구분') >= 0))
      : ((sampleRow?.length ?? 0) >= 25);

    const base = isLikelyNew ? fallbackNew : fallbackOld;

    const resolved = {
      assignee: (() => { const idx = findValueColumn('담당자'); return idx >= 0 ? idx : base.assignee; })(),
      task2: (() => {
        // "Task 2 Code" 와 "Task 2" 혼동 방지
        const idx = findValueColumn('task2');
        return idx >= 0 ? idx : base.task2;
      })(),
      taskCode: (() => { const idx = findValueColumn('taskcode'); return idx >= 0 ? idx : base.taskCode; })(),
      category1: (() => { const idx = findValueColumn('업무구분1'); return idx >= 0 ? idx : base.category1; })(),
      category2: (() => { const idx = findValueColumn('업무구분2'); return idx >= 0 ? idx : base.category2; })(),
      category3: (() => {
        // "Task 1 Code" 와 "Task 1" 혼동 방지
        const idx = findValueColumn('task1') >= 0 ? findValueColumn('task1') : findValueColumn('tasklv1');
        return idx >= 0 ? idx : base.category3;
      })(),
      planStart: (() => { const idx = findText('계획(시작일)'); return idx >= 0 ? idx : base.planStart; })(),
      planEnd: (() => { const idx = findText('계획(종료일)'); return idx >= 0 ? idx : base.planEnd; })(),
      actualStart: (() => { const idx = findText('실적(시작일)'); return idx >= 0 ? idx : base.actualStart; })(),
      actualEnd: (() => { const idx = findText('실적(종료일)'); return idx >= 0 ? idx : base.actualEnd; })(),
      planMH: (() => { const idx = findText('계획mh'); return idx >= 0 ? idx : base.planMH; })(),
      actualMH: (() => { const idx = findText('실적mh'); return idx >= 0 ? idx : base.actualMH; })(),
      status: (() => { const idx = findText('진행상태'); return idx >= 0 ? idx : base.status; })(),
      issue: (() => { const idx = findText('이슈및해결방안'); return idx >= 0 ? idx : base.issue; })(),
      review: (() => { const idx = findText('관리자검토의견'); return idx >= 0 ? idx : base.review; })(),
      inactive: (() => {
        const idx = findText('비활성화여부');
        return idx >= 0 ? idx : base.inactive;
      })(),
    };

    return resolved;
  };

  // 통합 업로드 핸들러 (모든 시트 처리)
  const handleIntegratedUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onerror = () => {
      alert('파일을 읽는 중 오류가 발생했습니다.');
      if (e.target) e.target.value = '';
    };

    reader.onload = (event) => {
      const fileData = event.target?.result;
      if (!fileData) {
        alert('파일 데이터를 읽을 수 없습니다.');
        if (e.target) e.target.value = '';
        return;
      }

      try {
        if (typeof XLSX === 'undefined') {
          alert('XLSX 라이브러리가 로드되지 않았습니다.');
          if (e.target) e.target.value = '';
          return;
        }

        const workbook = XLSX.read(fileData, { type: 'array' });
        const sheetNames = workbook.SheetNames;
        // ✅ 단일 시트만 있어도 존재하는 시트만 처리
        const requiredSheets = ['Task 관리', '업무_구분', 'OBS_관리', '사용자_관리', '조직_관리'] as const;
        const sheetStatus = new Map<string, { status: '처리됨' | '누락' | '오류' | '스킵'; detail?: string }>();
        requiredSheets.forEach(s => sheetStatus.set(s, sheetNames.includes(s) ? { status: '스킵' } : { status: '누락' }));
        let processedSheets = 0;
        let totalErrors: string[] = [];
        const sheetSummaries = new Map<string, { created: number; updated: number; unchanged: number }>();

        // ✅ 처리 순서 고정: 조직 -> Task -> 업무_구분 -> OBS -> 사용자 (조직 먼저 처리 후 다른 데이터 검증 가능)
        const getSheetPriority = (name: string) => {
          if (name === '조직_관리' || name.includes('조직')) return -1;
          if (name === 'Task_등록' || name === 'Task 관리' || name.replace(/\s+/g, '') === 'Task관리' || name.includes('Task')) return 0;
          if (name === '업무_구분' || name.includes('업무')) return 1;
          if (name === 'OBS_관리' || name.includes('OBS')) return 2;
          if (name === '사용자_관리' || name.includes('사용자')) return 3;
          return 99;
        };
        const orderedSheetNames = [...sheetNames].sort((a, b) => getSheetPriority(a) - getSheetPriority(b));

        // ✅ 같은 파일 내 업무_구분 업로드가 있다면, 그 결과를 OBS Lv.3 검증에 반영하기 위한 로컬 스냅샷
        let categoryMasterForObsValidation: CategoryMaster =
          (data.organization.departments[0]?.teams[0]?.categoryMaster as any) || categoryMasterData;

        // 각 시트 처리
        orderedSheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][];

          if (!jsonData || jsonData.length < 2) return;

          try {
            // 시트 이름에 따라 처리
            if (
              sheetName === 'Task_등록' ||
              sheetName === 'Task 관리' ||
              sheetName.replace(/\s+/g, '') === 'Task관리' ||
              sheetName.includes('Task')
            ) {
              // Task 등록 처리 - 내보내기 형식에 맞춰 처리 (Row 4가 헤더, Row 5부터 데이터)
              const headerRow = (jsonData[3] || []) as any[];
              const rows = jsonData.slice(4); // 헤더 4줄 제외하고 데이터 시작
              const taskErrors = handleTaskUploadFromSheet(rows, headerRow, {
                collectErrors: true,
                onSummary: (s) => sheetSummaries.set('Task 관리', s)
              }) || [];
              if (taskErrors.length > 0) {
                totalErrors.push(...taskErrors.map(err => `[${sheetName} 시트] ${err}`));
                sheetStatus.set('Task 관리', { status: '오류', detail: `오류 ${taskErrors.length}건` });
              } else {
                sheetStatus.set('Task 관리', { status: '처리됨' });
              }
              processedSheets++;
            } else if (sheetName === '업무_구분' || sheetName.includes('업무')) {
              // 업무 구분 처리
              const rows = jsonData.slice(1); // 헤더 제외
              const catResult = handleCategoryUpload(rows, {
                onSummary: (s) => sheetSummaries.set('업무_구분', s),
                onNextCategoryMaster: (next) => { categoryMasterForObsValidation = next; }
              });
              const catErrors = catResult.errors || [];
              if (catErrors.length > 0) {
                totalErrors.push(...catErrors.map(err => `[${sheetName} 시트] ${err}`));
                sheetStatus.set('업무_구분', { status: '오류', detail: `오류 ${catErrors.length}건` });
              } else {
                sheetStatus.set('업무_구분', { status: '처리됨' });
              }
              processedSheets++;
            } else if (sheetName === 'OBS_관리' || sheetName.includes('OBS')) {
              // OBS 관리 처리
              const rows = jsonData.slice(1); // 헤더 제외
              const obsErrors = handleOBSUpload(rows, {
                onSummary: (s) => sheetSummaries.set('OBS_관리', s),
                categoryMasterForValidation: categoryMasterForObsValidation
              }) || [];
              if (obsErrors.length > 0) {
                totalErrors.push(...obsErrors.map(err => `[${sheetName} 시트] ${err}`));
                sheetStatus.set('OBS_관리', { status: '오류', detail: `오류 ${obsErrors.length}건` });
              } else {
                sheetStatus.set('OBS_관리', { status: '처리됨' });
              }
              processedSheets++;
            } else if (sheetName === '조직_관리' || sheetName.includes('조직')) {
              // 조직 관리 처리
              const rows = jsonData.slice(1); // 헤더 제외
              const orgErrors = handleOrgUpload(rows, {
                collectErrors: true,
                onSummary: (s) => sheetSummaries.set('조직_관리', s)
              }) || [];
              if (orgErrors.length > 0) {
                totalErrors.push(...orgErrors.map(err => `[${sheetName} 시트] ${err}`));
                sheetStatus.set('조직_관리', { status: '오류', detail: `오류 ${orgErrors.length}건` });
              } else {
                sheetStatus.set('조직_관리', { status: '처리됨' });
              }
              processedSheets++;
            } else if (sheetName === '사용자_관리' || sheetName.includes('사용자')) {
              // 사용자 관리 처리
              if (jsonData.length < 2) {
                totalErrors.push(`${sheetName} 시트: 데이터가 없거나 양식이 맞지 않습니다.`);
                return;
              }
              const rows = jsonData.slice(1); // 헤더 제외
              const userErrors = handleUserUpload(rows, {
                collectErrors: true,
                onSummary: (s) => sheetSummaries.set('사용자_관리', s)
              });
              if (userErrors && userErrors.length > 0) {
                totalErrors.push(...userErrors.map(err => `[${sheetName} 시트] ${err}`));
              }
              processedSheets++;
              sheetStatus.set('사용자_관리', { status: '처리됨' });
            }
          } catch (error: any) {
            totalErrors.push(`${sheetName} 시트 처리 중 오류: ${error.message}`);
            // 표준 시트명으로 매핑(가능한 경우)
            if (sheetName.includes('조직')) sheetStatus.set('조직_관리', { status: '오류', detail: error.message });
            if (sheetName.includes('Task')) sheetStatus.set('Task 관리', { status: '오류', detail: error.message });
            if (sheetName.includes('업무')) sheetStatus.set('업무_구분', { status: '오류', detail: error.message });
            if (sheetName.includes('OBS')) sheetStatus.set('OBS_관리', { status: '오류', detail: error.message });
            if (sheetName.includes('사용자')) sheetStatus.set('사용자_관리', { status: '오류', detail: error.message });
          }
        });

        // ✅ 누락/처리 결과를 모든 시트에 대해 동일 형식으로 표시
        const statusLines = requiredSheets.map(s => {
          const st = sheetStatus.get(s);
          if (!st) return `- [${s}] 알 수 없음`;
          const extra = st.detail ? ` (${st.detail})` : '';
          const sum = sheetSummaries.get(s) ?? { created: 0, updated: 0, unchanged: 0 };
          const summaryText = ` (신규 ${sum.created}건, 변경 ${sum.updated}건, 변경 없음 ${sum.unchanged}건)`;
          return `- [${s}] ${st.status}${extra}${summaryText}`;
        });

        // ✅ 항상 통합 업로드 결과 모달 표시 (에러 유무와 관계없이)
        setIntegratedUploadStatusLines(statusLines);
        setIntegratedUploadErrorReasons(totalErrors);
        setUploadErrors([]); // legacy errors 초기화(혼합 표시 방지)
        setErrorModalTitle('통합 업로드 결과');
        setIsErrorModalOpen(true);
        
        // 알림 표시
        if (totalErrors.length > 0) {
          addNotification('통합 업로드 중 일부 오류가 발생했습니다.', 'error');
        } else if (processedSheets > 0) {
          addNotification(`${processedSheets}개 시트가 성공적으로 처리되었습니다.`, 'success');
        }

        // 파일 입력 초기화
        e.target.value = '';
      } catch (error: any) {
        console.error('통합 업로드 오류:', error);
        const errorMessage = error?.message || String(error) || '알 수 없는 오류';
        alert(`파일을 읽는 중 오류가 발생했습니다.\n\n오류 내용: ${errorMessage}`);
        if (e.target) e.target.value = '';
      }
    };
  };

  // Task 등록 업로드 헬퍼 (내보내기 형식)
  // - 통합 업로드에서는 errors를 반환만 하고 모달은 바깥에서 1회만 띄움
  const handleTaskUploadFromSheet = (
    rows: any[][],
    headerRow?: any[],
    opts?: { collectErrors?: boolean; onSummary?: (s: { created: number; updated: number; unchanged: number }) => void }
  ) => {
    const todayStr = new Date().toISOString().split('T')[0];
    let updatedTaskList = [...data.tasks];
    let createCount = 0;
    let updateCount = 0;
    let noChangeCount = 0;
    let skipCount = 0;

    const col = resolveTaskSheetColumnMap(headerRow, rows[0]);
    const parseInactiveFlag = (v: any): boolean | null => {
      const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
      if (!s) return null;
      if (['y', 'yes', 'true', '1', '비활성', '숨김', 'inactive'].some(k => s === k || s.includes(k))) return true;
      if (['n', 'no', 'false', '0', '활성', 'active'].some(k => s === k || s.includes(k))) return false;
      return null;
    };
    const incRegistration = (current: string | undefined, mode: 'create' | 'update', createPrefix: 'R' | 'NR' = 'R') => {
      const parsed = parseRegistration(current);
      if (mode === 'create') return `${createPrefix}.0`;
      if (parsed) return `${parsed.prefix}.${parsed.n + 1}`;
      return 'R.1';
    };
    const isValidYYYYMMDD = (s: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return false;
      return d.toISOString().slice(0, 10) === s;
    };
    const errors: string[] = [];
    // 정규화된 비교 함수: 날짜는 YYYY-MM-DD로, 시수는 hh.mm 형식으로 정규화하여 비교
    const isSame = (a: any, b: any) => {
      const aVal = a ?? '';
      const bVal = b ?? '';
      if (aVal === '' && bVal === '') return true;
      if (aVal === '' || bVal === '') return false;
      // 날짜 형식 정규화 (YYYY-MM-DD)
      const normalizeDate = (d: any): string => {
        if (!d) return '';
        const s = String(d).trim();
        // Excel 날짜 숫자 형식 처리 (예: 45321 -> 2024-01-15)
        if (/^\d+$/.test(s) && s.length > 5) {
          try {
            const excelDate = new Date((parseInt(s, 10) - 25569) * 86400 * 1000);
            if (!isNaN(excelDate.getTime())) {
              return excelDate.toISOString().split('T')[0];
            }
          } catch (e) {}
        }
        // YYYY-MM-DD 형식으로 변환 시도
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        // YYYY/MM/DD 형식 처리
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
        // 기타 날짜 형식 처리
        try {
          const date = new Date(s);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
          }
        } catch (e) {}
        return s;
      };
      // 시수 형식 정규화 (hh.mm)
      const normalizeHours = (h: any): string => {
        if (!h) return '';
        const s = String(h).trim();
        if (!s) return '';
        const normalized = normalizeFlexibleHHMMInput(s);
        if (normalized) return normalized;
        // normalizeFlexibleHHMMInput이 실패하면 normalizeHHMM 시도
        try {
          const normalized2 = normalizeHHMM(s);
          if (normalized2) return normalized2;
        } catch (e) {}
        return s;
      };
      // 날짜 비교 (YYYY-MM-DD 형식으로 정규화)
      const aDate = normalizeDate(aVal);
      const bDate = normalizeDate(bVal);
      if (aDate && bDate && /^\d{4}-\d{2}-\d{2}$/.test(aDate) && /^\d{4}-\d{2}-\d{2}$/.test(bDate)) {
        return aDate === bDate;
      }
      // 시수 비교 (hh.mm 형식으로 정규화)
      const aHours = normalizeHours(aVal);
      const bHours = normalizeHours(bVal);
      if (aHours && bHours && /^\d+\.\d{2}$/.test(aHours) && /^\d+\.\d{2}$/.test(bHours)) {
        return aHours === bHours;
      }
      // 일반 문자열 비교
      return aVal === bVal;
    };

    const taskMapByCode = new Map<string, number[]>();
    
    updatedTaskList.forEach((t, index) => {
      if (t.taskCode) {
        const key = normalizeTaskCodeKey(t.taskCode);
        if (!taskMapByCode.has(key)) {
          taskMapByCode.set(key, []);
        }
        taskMapByCode.get(key)!.push(index);
      }
    });
    
    const newCodesInBatch = new Set<string>();

    rows.forEach((row, idx) => {
      const rawAssignee = row[col.assignee];
      const rawTaskName = row[col.task2];

      if (!rawAssignee || !rawTaskName) {
        skipCount++;
        return;
      }

      const rawInputTaskCode = row[col.taskCode] ? String(row[col.taskCode]).trim() : '';
      const inputTaskCode = rawInputTaskCode ? normalizeTaskCodeKey(rawInputTaskCode) : '';
      const taskName = String(rawTaskName).trim();
      const assigneeName = String(rawAssignee).trim();

      // 엑셀에서 비어있으면 null로 처리 (기존 값 유지)
      // 날짜는 Excel 날짜 숫자 형식도 처리
      const normalizeExcelDate = (val: any): string | null => {
        if (!val) return null;
        const s = String(val).trim();
        if (!s) return null;
        // Excel 날짜 숫자 형식 처리 (예: 45321 -> 2024-01-15)
        if (/^\d+\.?\d*$/.test(s)) {
          const num = parseFloat(s);
          if (num > 25569) { // Excel 날짜 기준 (1900-01-01)
            try {
              const excelDate = new Date((num - 25569) * 86400 * 1000);
              if (!isNaN(excelDate.getTime())) {
                return excelDate.toISOString().split('T')[0];
              }
            } catch (e) {}
          }
        }
        // YYYY-MM-DD 형식 확인
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        // YYYY/MM/DD 형식 처리
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) return s.replace(/\//g, '-');
        // 기타 날짜 형식 처리
        try {
          const date = new Date(s);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
          }
        } catch (e) {}
        return s;
      };
      const rawPlanStart = row[col.planStart] ? String(row[col.planStart]).trim() : '';
      const rawPlanEnd = row[col.planEnd] ? String(row[col.planEnd]).trim() : '';
      const planStart = rawPlanStart ? normalizeExcelDate(rawPlanStart) : null;
      const planEnd = rawPlanEnd ? normalizeExcelDate(rawPlanEnd) : null;
      const actualStart = row[col.actualStart] ? String(row[col.actualStart]).trim() : null;
      const actualEnd = row[col.actualEnd] ? String(row[col.actualEnd]).trim() : null;
      const rawPlanMH = row[col.planMH] != null ? String(row[col.planMH]).trim() : '';
      const rawActualMH = row[col.actualMH] != null ? String(row[col.actualMH]).trim() : '';
      // 엑셀에서 비어있으면 null로 처리 (기존 값 유지)
      const planMH = rawPlanMH === '' ? null : (normalizeFlexibleHHMMInput(rawPlanMH) ?? null);
      const actualMH = rawActualMH === '' ? null : (normalizeFlexibleHHMMInput(rawActualMH) ?? null);

      // ✅ 유효성 검사: O,P(YYYY-MM-DD), S,T(hh.mm)
      if (planStart && !isValidYYYYMMDD(planStart)) {
        errors.push(`행 ${idx + 5}: 계획(시작일) 형식 오류 (YYYY-MM-DD) → "${planStart}"`);
        skipCount++;
        return;
      }
      if (planEnd && !isValidYYYYMMDD(planEnd)) {
        errors.push(`행 ${idx + 5}: 계획(종료일) 형식 오류 (YYYY-MM-DD) → "${planEnd}"`);
        skipCount++;
        return;
      }
      if (rawPlanMH !== '' && (!planMH || !validateHHMM(planMH, true))) {
        errors.push(`행 ${idx + 5}: 계획MH 형식 오류 (hh.mm, mm: 0~60) → "${rawPlanMH}"`);
        skipCount++;
        return;
      }
      if (rawActualMH !== '' && (!actualMH || !validateHHMM(actualMH, true))) {
        errors.push(`행 ${idx + 5}: 실적MH 형식 오류 (hh.mm, mm: 0~60) → "${rawActualMH}"`);
        skipCount++;
        return;
      }
      
      // 진행상태(진척률과 별개) 업로드 반영: 완료/진행중/지연/미시작
      let statusText = row[col.status] ? String(row[col.status]).trim() : '';
      let newStatus: TaskStatus | null = null;
      if (statusText === '완료') newStatus = 'completed';
      else if (statusText === '진행중') newStatus = 'in-progress';
      else if (statusText === '지연') newStatus = 'delayed';
      else if (statusText === '미시작') newStatus = 'not-started';

      // ⚠ 업로드 제외 컬럼(변경 판단/반영 대상 아님): 진척률, 비활성화 여부, 이슈 및 해결방안, 관리자 검토의견
      // const issueText = row[col.issue] ? String(row[col.issue]).trim() : '';
      // const inactiveFlag = col.inactive >= 0 ? parseInactiveFlag(row[col.inactive]) : null;

      if (inputTaskCode && taskMapByCode.has(inputTaskCode)) {
        const targetIndices = taskMapByCode.get(inputTaskCode)!;
        // 동일 Task Code가 여러 개면, 등록구분 Latest(=revisions 길이 최대) 기준으로 1개만 갱신
        const targetIndex = targetIndices.reduce((best, cur) => {
          const bestRev = updatedTaskList[best]?.revisions?.length ?? 0;
          const curRev = updatedTaskList[cur]?.revisions?.length ?? 0;
          return curRev >= bestRev ? cur : best;
        }, targetIndices[0]);

        const targetTask = updatedTaskList[targetIndex];
          const nextReg = incRegistration(targetTask.registration, 'update');
          // ✅ 같은 Task Code + 같은 등록구분이 이미 존재하면 에러(등록/업데이트 금지)
          const dupSameReg = targetIndices.some(i =>
            i !== targetIndex &&
            String(updatedTaskList[i]?.registration ?? '').trim().toUpperCase() === nextReg
          );
          if (dupSameReg) {
            errors.push(`행 ${idx + 5}: Task Code(${rawInputTaskCode}) 등록구분(${nextReg}) 중복으로 업데이트 불가`);
            skipCount++;
            return;
          }

          // ✅ 변경사항 없음이면: 등록구분 증가/이슈기록/수정 모두 하지 않음
          const currentPlan = getCurrentPlan(targetTask);
          // 업로드 제외 컬럼: 비활성화 여부는 반영/변경 판단하지 않음
          // 엑셀에서 비어있으면(null) 기존 값과 비교하지 않음 (변경 없음으로 간주)
          const planChanged =
            (planStart !== null && !isSame(currentPlan.startDate, planStart)) ||
            (planEnd !== null && !isSame(currentPlan.endDate, planEnd)) ||
            (planMH !== null && !isSame(currentPlan.hours, planMH));
          const actualChanged =
            (actualStart !== null && !isSame(targetTask.actual?.startDate, actualStart)) ||
            (actualEnd !== null && !isSame(targetTask.actual?.endDate, actualEnd)) ||
            (actualMH !== null && !isSame(targetTask.actual?.hours, actualMH));
          const statusChanged = !!newStatus && targetTask.status !== newStatus;
          // 업로드 제외 컬럼(변경 판단/반영 대상 아님): 진척률, 비활성화 여부, 이슈 및 해결방안, 관리자 검토의견
          if (!planChanged && !actualChanged && !statusChanged) {
            noChangeCount++;
            return;
          }

          const updatedActual = { ...targetTask.actual };
          if (actualStart !== null) updatedActual.startDate = actualStart;
          if (actualEnd !== null) updatedActual.endDate = actualEnd;
          if (actualMH !== null) updatedActual.hours = actualMH;

          let updatedIssues = [...targetTask.monthlyIssues];
          // ✅ Task 관리 자동 기록(변경 내역 + 등록구분 병기)
          // 변경된 항목만 기록 (null인 경우 기존 값 유지)
          const finalPlanStart = planStart !== null ? planStart : currentPlan.startDate;
          const finalPlanEnd = planEnd !== null ? planEnd : currentPlan.endDate;
          const finalPlanMH = planMH !== null ? planMH : currentPlan.hours;
          const finalActualStart = actualStart !== null ? actualStart : targetTask.actual?.startDate || '';
          const finalActualEnd = actualEnd !== null ? actualEnd : targetTask.actual?.endDate || '';
          const finalActualMH = actualMH !== null ? actualMH : targetTask.actual?.hours || '00.00';
          updatedIssues.push({
            date: todayStr,
            issue: `[Task 관리][${nextReg}] 변경: 계획(${finalPlanStart || ''}~${finalPlanEnd || ''}, ${finalPlanMH || '00.00'}), 실적(${finalActualStart || ''}~${finalActualEnd || ''}, ${finalActualMH || '00.00'}), 상태(${newStatus || targetTask.status})`,
            author: 'System',
            reviewed: false,
            replies: []
          });

          // ✅ Task 관리 업로드: 동일 Task Code면 등록구분 R.n을 올리기 위해 계획(revisions)을 1건 추가
          // 변경된 값만 반영 (null인 경우 기존 값 유지)
          const newRevision: Revision = {
            revisionDate: todayStr,
            reason: 'Task 관리 업로드',
            period: { startDate: finalPlanStart, endDate: finalPlanEnd, hours: finalPlanMH || '00.00' }
          };
          const updatedRevisions = [...(targetTask.revisions || []), newRevision];

          updatedTaskList[targetIndex] = {
            ...targetTask,
            revisions: updatedRevisions,
            registration: nextReg,
            actual: updatedActual,
            monthlyIssues: updatedIssues,
            ...(newStatus ? { status: newStatus } : {})
          };

        updateCount += 1;
      } 
      else {
        let foundMember: any = null;
        outerSearch:
        for (const d of data.organization.departments) { 
          for (const t of d.teams) {
            for (const g of t.groups) {
              const m = g.members.find(mem => mem.name === assigneeName);
              if (m) {
                foundMember = { ...m, group: g.name, team: t.name, department: d.name };
                break outerSearch;
              }
            }
          }
        }

        const assigneeId = foundMember ? foundMember.id : `guest_${Date.now()}_${idx}`;

        // Task Code 결정:
        // - Task Code가 비어있으면 신규 과제 → 자동 채번
        // - 값이 있으면 신규로 그대로 사용(단, 기존에 있으면 위에서 처리됨)
        let finalTaskCode = inputTaskCode;
        if (!finalTaskCode) {
          const adminCategoryMaster = data.organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
          finalTaskCode = generateTaskCodeForTask2({
            taskName,
            category1: row[col.category1] || '',
            category2: row[col.category2] || '',
            category3: row[col.category3] || '',
            memberInfo: foundMember ? { department: foundMember.department, team: foundMember.team, group: foundMember.group } : null,
            adminCategoryMaster,
            existingTasks: updatedTaskList
          });
          finalTaskCode = normalizeTaskCodeKey(finalTaskCode);
        } else {
          // 입력된 Task Code도 정규화된 형태로 저장
          finalTaskCode = normalizeTaskCodeKey(finalTaskCode);
        }
        // 배치 내 중복 방지(희귀 케이스)
        if (newCodesInBatch.has(finalTaskCode) || taskMapByCode.has(finalTaskCode)) {
          const base = finalTaskCode;
          let suffix = 1;
          let temp = `${base}_${suffix}`;
          while (newCodesInBatch.has(temp) || taskMapByCode.has(temp)) {
            suffix += 1;
            temp = `${base}_${suffix}`;
          }
          finalTaskCode = temp;
        }
        newCodesInBatch.add(finalTaskCode);

        const isAutoCode = !inputTaskCode; // Task Code 비움(신규) => NR.0
        const newReg = incRegistration(undefined, 'create', isAutoCode ? 'NR' : 'R');
        // 신규 생성인데 동일 Task Code + 동일 등록구분이 이미 있으면 에러
        const existingIdxs = taskMapByCode.get(finalTaskCode) || [];
        const dupSameRegOnCreate = existingIdxs.some(i =>
          String(updatedTaskList[i]?.registration ?? '').trim().toUpperCase() === newReg
        );
        if (dupSameRegOnCreate) {
          errors.push(`행 ${idx + 5}: Task Code(${rawInputTaskCode || finalTaskCode}) 등록구분(${newReg}) 중복으로 신규 등록 불가`);
          skipCount++;
          return;
        }
        const newTask: Task = {
          id: `upload_${Date.now()}_${idx}`,
          taskCode: finalTaskCode,
          category1: row[col.category1] || '',
          category2: row[col.category2] || '',
          category3: row[col.category3] || '',
          name: makeUniqueTask2Name(updatedTaskList, assigneeId, taskName),
          department: foundMember ? foundMember.department : (row[1] || '미지정'),
          team: foundMember ? foundMember.team : (row[2] || '미지정'),
          group: foundMember ? foundMember.group : (row[3] || '미지정'),
          assignee: assigneeId,
          assigneeName: assigneeName,
          createdByRole: (currentUser?.role || 'admin') as UserRole,
          createdVia: 'integrated_upload',
          registration: newReg,
          planned: { startDate: planStart, endDate: planEnd, hours: planMH },
          revisions: [],
          actual: { startDate: actualStart, endDate: actualEnd, hours: actualMH },
          monthlyIssues: [
            {
              date: todayStr,
              issue: `[Task 관리][${newReg}] 신규 등록`,
              author: 'System',
              reviewed: false,
              replies: []
            },
          ],
          status: newStatus || 'not-started',
          isActive: true
        };

        const newTaskIndex = updatedTaskList.length;
        updatedTaskList.push(newTask);
        
        if (!taskMapByCode.has(finalTaskCode)) {
          taskMapByCode.set(finalTaskCode, []);
        }
        taskMapByCode.get(finalTaskCode)!.push(newTaskIndex);
        
        createCount++;
      }
    });

    if (createCount > 0 || updateCount > 0) {
      setData(prev => ({ ...prev, tasks: updatedTaskList }));
    }
    if (createCount > 0 || updateCount > 0 || noChangeCount > 0) {
      addNotification(`Task 등록: 신규 ${createCount}건, 업데이트 ${updateCount}건, 변경사항 없음 ${noChangeCount}건 (제외 ${skipCount}건)`, 'success');
    }
    opts?.onSummary?.({ created: createCount, updated: updateCount, unchanged: noChangeCount });
    if (errors.length > 0 && !opts?.collectErrors) {
      // 통합 업로드 섹션 데이터가 남아있으면 혼합 표시될 수 있으므로 초기화
      setIntegratedUploadStatusLines([]);
      setIntegratedUploadErrorReasons([]);
      setUploadErrors(errors);
      setErrorModalTitle('Task 등록 오류');
      setIsErrorModalOpen(true);
    }
    return errors;
  };

  // 업무 구분 업로드 헬퍼
  // - 템플릿 형식: [Lv1 code, Lv1 명칭, Lv2 code, Lv2 명칭, Lv3 code, Lv3 명칭]
  // - 하위 호환: [Lv1 명칭, Lv2 명칭, Lv3 명칭]
  // - 에러는 "행 번호 + 원인" 형태로 반환
  const handleCategoryUpload = (
    rows: any[][],
    opts?: {
      onSummary?: (s: { created: number; updated: number; unchanged: number }) => void;
      onNextCategoryMaster?: (next: CategoryMaster) => void;
    }
  ): { errors: string[]; nextCategoryMaster: CategoryMaster } => {
    const activeCategoryData: CategoryMaster =
      (data.organization.departments[0]?.teams[0]?.categoryMaster as any) || {};
    const newCategoryData = JSON.parse(JSON.stringify(activeCategoryData));
    let addedCount = 0;
    let noChangeCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const norm = (v: any) => (v ?? '').toString().trim();

    rows.forEach((row, index) => {
      const rowIndex = index + 2; // 헤더 제외 실제 행 번호

      let lv1Name = '', lv2Name = '', lv3Name = '';
      if ((row?.length ?? 0) >= 6) {
        // 새 형식(code 포함)
        lv1Name = norm(row[1]);
        lv2Name = norm(row[3]);
        lv3Name = norm(row[5]);
      } else {
        // 구 형식
        lv1Name = norm(row?.[0]);
        lv2Name = norm(row?.[1]);
        lv3Name = norm(row?.[2]);
      }

      // 완전 빈 행은 무시
      if (!lv1Name && !lv2Name && !lv3Name) return;

      // 필수값 체크 (*Lv1/*Lv2/*Lv3)
      if (!lv1Name || !lv2Name || !lv3Name) {
        errors.push(`행 ${rowIndex}: 필수 항목 누락 (*Lv1 명칭, *Lv2 명칭, *Lv3 명칭)`);
        skippedCount++;
        return;
      }

      if (!newCategoryData[lv1Name]) {
        newCategoryData[lv1Name] = {};
      }
      if (lv2Name && !newCategoryData[lv1Name][lv2Name]) {
        newCategoryData[lv1Name][lv2Name] = [];
      }
      if (lv3Name && lv2Name && !newCategoryData[lv1Name][lv2Name].includes(lv3Name)) {
        newCategoryData[lv1Name][lv2Name].push(lv3Name);
        addedCount++;
      } else if (lv3Name && lv2Name) {
        // 이미 존재하는 항목(변경 없음)도 집계
        const existed =
          !!activeCategoryData?.[lv1Name]?.[lv2Name] &&
          Array.isArray(activeCategoryData[lv1Name][lv2Name]) &&
          activeCategoryData[lv1Name][lv2Name].includes(lv3Name);
        if (existed) noChangeCount++;
      }
    });

    if (addedCount > 0) {
      const newOrg = JSON.parse(JSON.stringify(data.organization));
      if (newOrg.departments[0]?.teams[0]) {
        newOrg.departments[0].teams[0].categoryMaster = newCategoryData;
        setData(prev => ({ ...prev, organization: newOrg }));
        addNotification(`업무 구분 ${addedCount}개 추가`, 'success');
      }
    }
    if (errors.length > 0) {
      addNotification(`업무 구분 업로드: 추가 ${addedCount}건, 제외 ${skippedCount}건`, 'error');
    } else if (addedCount === 0) {
      addNotification('업무 구분 업로드: 변경사항 없음', 'success');
    }
    opts?.onSummary?.({ created: addedCount, updated: 0, unchanged: noChangeCount });
    opts?.onNextCategoryMaster?.(newCategoryData);
    return { errors, nextCategoryMaster: newCategoryData };
  };

  // OBS 관리 업로드 헬퍼
  // - 템플릿 형식: [Lv.1 코드, Lv.1 분류, Lv.2 코드, Lv.2 분류, Lv.3 코드, Lv.3 분류]
  // - 하위 호환: [Lv.1 분류, Lv.2 분류, Lv.3 분류]
  // - 에러는 "행 번호 + 원인" 형태로 반환
  const handleOBSUpload = (
    rows: any[][],
    opts?: {
      onSummary?: (s: { created: number; updated: number; unchanged: number }) => void;
      categoryMasterForValidation?: CategoryMaster;
    }
  ): string[] => {
    const activeOBSData = data.organization.departments[0]?.teams[0]?.obsMaster || {};
    const newOBSData = JSON.parse(JSON.stringify(activeOBSData));
    let addedCount = 0;
    let noChangeCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const norm = (v: any) => (v ?? '').toString().trim();
    // ✅ Lv.3(업무 구분3) 유효성 검증: 업무_구분(Lv.3)에 없는 값이면 오류
    const FIXED_LV1_OPTIONS = ["1. 중점과제", "2. 지시과제", "3. 자체과제", "4. 현장지원", "5. 기타"];
    const categoryMasterForValidation =
      (opts?.categoryMasterForValidation as any) ||
      ((data.organization.departments[0]?.teams[0]?.categoryMaster as any) || categoryMasterData);
    const isLv3Valid = (lv3Name: string) => {
      if (!lv3Name) return false;
      for (const lv1Key of Object.keys(categoryMasterForValidation || {})) {
        const lv2Obj = (categoryMasterForValidation as any)[lv1Key] || {};
        for (const lv2Key of Object.keys(lv2Obj)) {
          const list = lv2Obj[lv2Key];
          if (Array.isArray(list) && list.includes(lv3Name)) return true;
        }
      }
      return false;
    };

    rows.forEach((row, index) => {
      const rowIndex = index + 2; // 헤더 제외 실제 행 번호
      // 템플릿 형식: [Lv.1 코드, Lv.1 분류, Lv.2 코드, Lv.2 분류, Lv.3 코드, Lv.3 분류]
      // 기존 형식도 지원: [Lv.1 분류, Lv.2 분류, Lv.3 분류] (하위 호환성)
      let lv1 = '', lv2 = '', lv3 = '';
      
      if (row.length >= 6) {
        // 새 형식 (code 포함)
        lv1 = norm(row[1]);
        lv2 = norm(row[3]);
        lv3 = norm(row[5]);
      } else {
        // 기존 형식 (하위 호환성)
        lv1 = norm(row?.[0]);
        lv2 = norm(row?.[1]);
        lv3 = norm(row?.[2]);
      }
      
      // 완전 빈 행은 무시
      if (!lv1 && !lv2 && !lv3) return;

      // 필수값 체크 (*Lv1/*Lv2/*Lv3)
      if (!lv1 || !lv2 || !lv3) {
        errors.push(`행 ${rowIndex}: 필수 항목 누락 (*Lv1 명칭, *Lv2 명칭, *Lv3 명칭)`);
        skippedCount++;
        return;
      }

      // Lv1 옵션 유효성
      if (!FIXED_LV1_OPTIONS.includes(lv1)) {
        errors.push(`행 ${rowIndex}: Lv.1 "${lv1}"는 유효한 옵션이 아닙니다. (${FIXED_LV1_OPTIONS.join(', ')} 중 선택)`);
        skippedCount++;
        return;
      }

      // ✅ Lv.3(업무 구분3) 존재 여부 체크
      if (!isLv3Valid(lv3)) {
        errors.push(`행 ${rowIndex}: Lv.3 "${lv3}"가 업무_구분(Lv.3)에 존재하지 않습니다.`);
        skippedCount++;
        return;
      }

      if (!newOBSData[lv1]) {
        newOBSData[lv1] = {};
      }
      if (!newOBSData[lv1][lv2]) {
        newOBSData[lv1][lv2] = [];
      }
      if (lv3 && !newOBSData[lv1][lv2].includes(lv3)) {
        newOBSData[lv1][lv2].push(lv3);
        addedCount++;
      } else if (lv3) {
        // 이미 존재하는 항목(변경 없음)도 집계
        const existed =
          !!activeOBSData?.[lv1]?.[lv2] &&
          Array.isArray(activeOBSData[lv1][lv2]) &&
          activeOBSData[lv1][lv2].includes(lv3);
        if (existed) noChangeCount++;
      }
    });

    if (addedCount > 0) {
      const newOrg = JSON.parse(JSON.stringify(data.organization));
      if (newOrg.departments[0]?.teams[0]) {
        newOrg.departments[0].teams[0].obsMaster = newOBSData;
        setData(prev => ({ ...prev, organization: newOrg }));
        addNotification(`OBS 관리 ${addedCount}개 추가`, 'success');
      }
    }
    if (errors.length > 0) {
      addNotification(`OBS 관리 업로드: 추가 ${addedCount}건, 제외 ${skippedCount}건`, 'error');
    } else if (addedCount === 0) {
      addNotification('OBS 관리 업로드: 변경사항 없음', 'success');
    }
    opts?.onSummary?.({ created: addedCount, updated: 0, unchanged: noChangeCount });
    return errors;
  };

  // 조직 관리 업로드 헬퍼
  const handleOrgUpload = (
    rows: any[][],
    opts?: {
      collectErrors?: boolean;
      onSummary?: (s: { created: number; updated: number; unchanged: number }) => void;
    }
  ): string[] => {
    const newOrg = JSON.parse(JSON.stringify(data.organization));
    const errors: string[] = [];
    let addedCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    const norm = (v: any) => (v ?? '').toString().trim();

    // 코드 중복 체크를 위한 맵
    const deptCodeMap = new Map<string, string>(); // code -> deptId
    const teamCodeMap = new Map<string, Map<string, string>>(); // deptId -> (code -> teamId)
    const groupCodeMap = new Map<string, Map<string, Map<string, string>>>(); // deptId -> teamId -> (code -> groupId)

    rows.forEach((row, index) => {
      const rowIndex = index + 2; // 헤더 제외하고 실제 행 번호
      const [deptCode, deptName, teamCode, teamName, groupCode, groupName] = row;

      const deptCodeV = norm(deptCode);
      const deptNameV = norm(deptName);
      const teamCodeV = norm(teamCode);
      const teamNameV = norm(teamName);
      const groupCodeV = norm(groupCode);
      const groupNameV = norm(groupName);

      // 빈 행은 무시
      if (!deptNameV && !teamNameV && !groupNameV) {
        return;
      }

      // 필수 항목 체크
      if (!deptNameV) {
        errors.push(`행 ${rowIndex}: Lv.1 실명은 필수입니다.`);
        return;
      }

      // 실 찾기 또는 생성
      let dept = newOrg.departments.find((d: Department) => d.name === deptNameV);
      if (!dept) {
        const newDeptId = `dept-${Date.now()}-${Math.random()}`;
        dept = {
          id: newDeptId,
          name: deptNameV,
          teams: []
        };
        (dept as any).code = deptCodeV || '';
        newOrg.departments.push(dept);
        addedCount++;
      } else {
        // 기존 실이 있는 경우
        if (deptCodeV && (dept as any).code !== deptCodeV) {
          // 중복 체크
          if (deptCodeMap.has(deptCodeV) && deptCodeMap.get(deptCodeV) !== dept.id) {
            errors.push(`행 ${rowIndex}: Lv.1 코드 "${deptCodeV}"는 이미 사용 중입니다.`);
            return;
          }
          (dept as any).code = deptCodeV;
          updatedCount++;
        } else {
          unchangedCount++;
        }
      }
      deptCodeMap.set((dept as any).code || '', dept.id);

      // 팀이 있는 경우
      if (teamNameV) {
        let team = dept.teams.find((t: Team) => t.name === teamNameV);
        if (!team) {
          const newTeamId = `team-${Date.now()}-${Math.random()}`;
          team = {
            id: newTeamId,
            name: teamNameV,
            groups: []
          };
          (team as any).code = teamCodeV || '';
          dept.teams.push(team);
          addedCount++;
        } else {
          // 기존 팀이 있는 경우
          if (teamCodeV && (team as any).code !== teamCodeV) {
            // 중복 체크
            if (!teamCodeMap.has(dept.id)) {
              teamCodeMap.set(dept.id, new Map());
            }
            const deptTeamMap = teamCodeMap.get(dept.id)!;
            if (deptTeamMap.has(teamCodeV) && deptTeamMap.get(teamCodeV) !== team.id) {
              errors.push(`행 ${rowIndex}: Lv.2 코드 "${teamCodeV}"는 같은 실 내에서 이미 사용 중입니다.`);
              return;
            }
            (team as any).code = teamCodeV;
            updatedCount++;
          } else {
            unchangedCount++;
          }
        }
        if (!teamCodeMap.has(dept.id)) {
          teamCodeMap.set(dept.id, new Map());
        }
        teamCodeMap.get(dept.id)!.set((team as any).code || '', team.id);

        // 그룹이 있는 경우
        if (groupNameV) {
          let group = team.groups.find((g: Group) => g.name === groupNameV);
          if (!group) {
            const newGroupId = `group-${Date.now()}-${Math.random()}`;
            group = {
              id: newGroupId,
              name: groupNameV,
              members: []
            };
            (group as any).code = groupCodeV || '';
            team.groups.push(group);
            addedCount++;
          } else {
            // 기존 그룹이 있는 경우
            if (groupCodeV && (group as any).code !== groupCodeV) {
              // 중복 체크
              if (!groupCodeMap.has(dept.id)) {
                groupCodeMap.set(dept.id, new Map());
              }
              if (!groupCodeMap.get(dept.id)!.has(team.id)) {
                groupCodeMap.get(dept.id)!.set(team.id, new Map());
              }
              const teamGroupMap = groupCodeMap.get(dept.id)!.get(team.id)!;
              if (teamGroupMap.has(groupCodeV) && teamGroupMap.get(groupCodeV) !== group.id) {
                errors.push(`행 ${rowIndex}: Lv.3 코드 "${groupCodeV}"는 같은 팀 내에서 이미 사용 중입니다.`);
                return;
              }
              (group as any).code = groupCodeV;
              updatedCount++;
            } else {
              unchangedCount++;
            }
          }
          if (!groupCodeMap.has(dept.id)) {
            groupCodeMap.set(dept.id, new Map());
          }
          if (!groupCodeMap.get(dept.id)!.has(team.id)) {
            groupCodeMap.get(dept.id)!.set(team.id, new Map());
          }
          groupCodeMap.get(dept.id)!.get(team.id)!.set((group as any).code || '', group.id);
        }
      }
    });

    if (addedCount > 0 || updatedCount > 0) {
      setData(prev => ({ ...prev, organization: newOrg }));
    }
    opts?.onSummary?.({ created: addedCount, updated: updatedCount, unchanged: unchangedCount });
    return errors;
  };

  // 사용자 관리 업로드 헬퍼
  const handleUserUpload = (
    rows: any[][],
    opts?: { collectErrors?: boolean; onSummary?: (s: { created: number; updated: number; unchanged: number }) => void }
  ): string[] => {
    const newOrg = JSON.parse(JSON.stringify(data.organization));
    let addedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    const existingLoginIds = new Set<string>();
    const norm = (v: any) => (v ?? '').toString().trim();
    const isDash = (v: any) => norm(v) === '-';

    // 기존 ID 수집
    newOrg.departments.forEach((d: any) => {
      d.teams.forEach((t: any) => {
        t.groups.forEach((g: any) => {
          g.members.forEach((m: any) => {
            if (m.loginId) existingLoginIds.add(m.loginId);
          });
        });
      });
    });

    rows.forEach((row, index) => {
      const rowIndex = index + 2; // 헤더 제외하고 실제 행 번호
      const [name, loginId, password, deptName, teamName, groupName, position, roleText] = row;

      const nameV = norm(name);
      const loginIdV = norm(loginId);
      const deptNameV = norm(deptName);
      const teamNameV = norm(teamName);
      const groupNameV = norm(groupName);
      const positionV = norm(position);
      const roleTextV = norm(roleText);

      // ✅ 빈 행 건너뛰기: 모든 필수 필드가 비어있으면 스킵
      if (!nameV && !loginIdV && !deptNameV && !teamNameV && !groupNameV) {
        return; // 에러 없이 건너뜀
      }

      // 권한 텍스트를 role로 변환 (템플릿: 관리자/실장/팀장/그룹장/팀원)
      let role: UserRole = 'member';
      if (roleTextV === '관리자') role = 'admin';
      else if (roleTextV === '실장') role = 'dept_head';
      else if (roleTextV === '팀장') role = 'team_leader';
      else if (roleTextV === '그룹장') role = 'group_leader';
      else if (roleTextV === '팀원') role = 'member';

      const isDeptHead = roleTextV === '실장' || role === 'dept_head' || positionV.includes('실장');
      const isTeamLeader = role === 'team_leader';

      // 필수 항목 체크
      // - 실장: 팀/그룹은 "-" 허용
      // - 팀장: 그룹은 "-" 허용
      if (!nameV || !loginIdV || !deptNameV) {
        errors.push(`행 ${rowIndex}: 필수 항목(이름, ID, 실)이 누락되었습니다.`);
        skippedCount++;
        return;
      }
      if (!isDeptHead && !teamNameV) {
        errors.push(`행 ${rowIndex}: 필수 항목(팀)이 누락되었습니다.`);
        skippedCount++;
        return;
      }
      if (!isDeptHead && !isTeamLeader && !groupNameV) {
        errors.push(`행 ${rowIndex}: 필수 항목(그룹)이 누락되었습니다.`);
        skippedCount++;
        return;
      }

      // ID 중복 체크 (이미 존재하는 ID는 스킵하되 에러로 표시하지 않음 - 업데이트는 별도 기능)
      if (existingLoginIds.has(loginIdV)) {
        // 중복 ID는 건너뛰지만, 사용자에게는 정보성 메시지로 표시
        skippedCount++;
        return; // 에러 목록에 추가하지 않음 (이미 존재하는 데이터는 정상)
      }

      // 조직 구조 찾기
      const dept = newOrg.departments.find((d: any) => d.name === deptNameV);
      if (!dept) {
        errors.push(`행 ${rowIndex}: 실 "${deptNameV}"을 찾을 수 없습니다.`);
        skippedCount++;
        return;
      }

      // 팀 결정
      let team: any = null;
      if (isDeptHead && (isDash(teamNameV) || !teamNameV)) {
        team = dept.teams?.[0] || null;
        if (!team) {
          errors.push(`행 ${rowIndex}: 실 "${deptNameV}"에 팀이 없어 실장 사용자를 추가할 수 없습니다.`);
          skippedCount++;
          return;
        }
      } else {
        team = dept.teams.find((t: any) => t.name === teamNameV);
        if (!team) {
          errors.push(`행 ${rowIndex}: 팀 "${teamNameV}"을 찾을 수 없습니다.`);
          skippedCount++;
          return;
        }
      }

      // 그룹 결정
      let group: any = null;
      if ((isDeptHead || isTeamLeader) && (isDash(groupNameV) || !groupNameV)) {
        group = team.groups?.[0] || null;
        if (!group) {
          errors.push(`행 ${rowIndex}: 팀 "${team.name}"에 그룹이 없어 사용자를 추가할 수 없습니다.`);
          skippedCount++;
          return;
        }
      } else {
        group = team.groups.find((g: any) => g.name === groupNameV);
        if (!group) {
          errors.push(`행 ${rowIndex}: 그룹 "${groupNameV}"을 찾을 수 없습니다.`);
          skippedCount++;
          return;
        }
      }

      // 사용자 추가
      const newMemberId = `emp_${Date.now()}_${index}`;
      group.members.push({
        id: newMemberId,
        name: nameV,
        loginId: loginIdV,
        password: norm(password) || '123',
        position: positionV || (roleTextV === '실장' ? '실장' : '선임연구원'),
        role
      });

      existingLoginIds.add(loginIdV);
      addedCount++;
    });

    opts?.onSummary?.({ created: addedCount, updated: 0, unchanged: 0 });

    // 통합 업로드에서는 모달을 여기서 띄우지 않고, 바깥(통합 결과)에서 1회에 모아서 표시
    if (errors.length > 0 && !opts?.collectErrors) {
      setIntegratedUploadStatusLines([]);
      setIntegratedUploadErrorReasons([]);
      setUploadErrors(errors);
      setErrorModalTitle('사용자_관리 오류');
      setIsErrorModalOpen(true);
    }

    if (addedCount > 0) {
      setData(prev => ({ ...prev, organization: newOrg }));
      addNotification(`사용자 ${addedCount}명 추가${skippedCount > 0 ? ` (${skippedCount}건 건너뜀)` : ''}`, 'success');
    } else if (skippedCount > 0) {
      addNotification(`추가된 사용자가 없습니다. (${skippedCount}건 건너뜀)`, 'error');
    }

    return errors;
  };

  const handleOpenTaskModal = () => {
    setTaskModalOpen(true);
  };

  const handleAddTask = (task: Task) => {
    const inferredRole: UserRole = (currentUser?.role || 'admin') as UserRole;
    // 동일 담당자에서 Task 2(name) 중복 시 "#n" 부여 (첫 중복은 #1)
    const uniqueName = makeUniqueTask2Name(data.tasks, task.assignee, task.name);
    const ensuredTask: Task = {
      ...task,
      name: uniqueName,
      createdByRole: task.createdByRole ?? inferredRole,
      createdVia: task.createdVia ?? 'manual',
      // ✅ Task 신규 등록(수동 등록)은 등록구분을 NR.0부터 시작
      registration: task.registration ?? 'NR.0'
    };

    // ✅ Task 등록 시 OBS 관리 자동 등록:
    // - 등록된 Task의 팀(task.team) + Task1(task.category3)을 OBS 마스터에 자동 반영
    // - Lv.1 분류는 매핑 정보가 없으므로 기본값 "4. 기타"로 자동 분류
    const DEFAULT_OBS_LV1 = '5. 기타';
    const lv3CodeFromTask = extractLv3CodeFromTaskCode(ensuredTask.taskCode);
    setData(prevData => {
      const nextOrg = JSON.parse(JSON.stringify(prevData.organization)) as Organization;

      let updated = false;
      nextOrg.departments.forEach(dept => {
        dept.teams.forEach(team => {
          if (team.name !== ensuredTask.team) return;
          if (!team.obsMaster) team.obsMaster = {};
          if (!team.obsMaster[DEFAULT_OBS_LV1]) team.obsMaster[DEFAULT_OBS_LV1] = {};
          if (!team.obsMaster[DEFAULT_OBS_LV1][ensuredTask.team]) team.obsMaster[DEFAULT_OBS_LV1][ensuredTask.team] = [];
          const arr = team.obsMaster[DEFAULT_OBS_LV1][ensuredTask.team] as string[];
          if (!arr.includes(ensuredTask.category3)) {
            arr.push(ensuredTask.category3);
            updated = true;
          }

          // ✅ 신규 Task 명/Task Code를 OBS 참조 데이터로 함께 저장
          if (!team.obsTaskCatalog) team.obsTaskCatalog = [];
          const existsByCode = team.obsTaskCatalog.some(x => String(x.taskCode || '') === String(ensuredTask.taskCode || ''));
          if (!existsByCode) {
            team.obsTaskCatalog.push({
              taskCode: ensuredTask.taskCode,
              taskName: ensuredTask.name,
              task1: ensuredTask.category3,
              lv3Code: lv3CodeFromTask || undefined,
              createdAt: new Date().toISOString()
            });
            updated = true;
          }
        });
      });

      return {
        ...prevData,
        organization: updated ? nextOrg : prevData.organization,
        tasks: [...prevData.tasks, ensuredTask]
      };
    });
  };

  // Lv.3 마스터 데이터 추가 핸들러
  const handleUpdateCategoryMaster = (category1: string, category2: string, category3: string) => {
    setData(prevData => {
      const newOrganization = JSON.parse(JSON.stringify(prevData.organization));
      
      // 모든 팀의 categoryMaster에 추가
      newOrganization.departments.forEach((dept: Department) => {
        dept.teams.forEach((team: Team) => {
          if (!team.categoryMaster[category1]) {
            team.categoryMaster[category1] = {};
          }
          if (!team.categoryMaster[category1][category2]) {
            team.categoryMaster[category1][category2] = [];
          }
          if (!team.categoryMaster[category1][category2].includes(category3)) {
            team.categoryMaster[category1][category2].push(category3);
          }
        });
      });
      
      return {
        ...prevData,
        organization: newOrganization
      };
    });
  };
  


  // [최종 수정] 복잡한 검사를 제거하고 템플릿의 절대 위치(인덱스)를 기준으로 강제 로딩
  // [수정] 엑셀 파일을 실제로 읽어 처리하는 로직으로 변경
  // [수정] 엑셀 업로드 핸들러 (타입 안전성 강화 버전)
  // [수정] 파일 읽기 방식을 ArrayBuffer로 변경하여 호환성/안정성 강화
  // [최종 수정] organization 변수 참조 오류 해결 버전
  // [최종 수정] 엑셀 업로드: 이름 중복 방지 + Task Code 자동 채번 + 오류 처리 강화
  //2601081234
  //2
  // [수정] 엑셀 업로드 핸들러 (중요도 컬럼 제거 반영 - 인덱스 -1 조정)

  //2601081241
  //2
  // [수정] 엑셀 업로드 핸들러 (신규 생성 + 기존 Task 실적/이슈 업데이트 통합)
  //2601080116
  //2
  // [수정] 엑셀 업로드 핸들러 (디버깅 로그 강화 및 신규/수정 로직 통합)
  const handleUpload = (file: File) => {
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);

    reader.onload = (e) => {
      const resultData = e.target?.result;
      if (!resultData) return;

      try {
        if (typeof XLSX === 'undefined') {
          alert('XLSX 라이브러리가 로드되지 않았습니다.');
          return;
        }

        const workbook = XLSX.read(resultData, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

        if (!jsonData || jsonData.length < 5) {
          addNotification('엑셀 파일에 데이터가 없거나 양식이 맞지 않습니다. (헤더 4줄 필수)', 'error');
          setUploadModalOpen(false);
          return;
        }

        const headerRow = (jsonData[3] || []) as any[]; // Row 4: 헤더
        const rows = jsonData.slice(4) as any[][]; // 헤더 제외 데이터 시작
        const col = resolveTaskSheetColumnMap(headerRow, rows[0]);
        const parseInactiveFlag = (v: any): boolean | null => {
          const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
          if (!s) return null;
          if (['y', 'yes', 'true', '1', '비활성', '숨김', 'inactive'].some(k => s === k || s.includes(k))) return true;
          if (['n', 'no', 'false', '0', '활성', 'active'].some(k => s === k || s.includes(k))) return false;
          return null;
        };
        const incRegistration = (current: string | undefined, mode: 'create' | 'update', createPrefix: 'R' | 'NR' = 'R') => {
          const parsed = parseRegistration(current);
          if (mode === 'create') return `${createPrefix}.0`;
          if (parsed) return `${parsed.prefix}.${parsed.n + 1}`;
          return 'R.1';
        };
        const isValidYYYYMMDD = (s: string) => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
          const d = new Date(s);
          if (Number.isNaN(d.getTime())) return false;
          return d.toISOString().slice(0, 10) === s;
        };
        const errors: string[] = [];
        const todayStr = new Date().toISOString().split('T')[0];

        let updatedTaskList = [...data.tasks];
        let createCount = 0;
        let updateCount = 0;
        let noChangeCount = 0;
        let skipCount = 0;
        const isSame = (a: any, b: any) => (a ?? '') === (b ?? '');

        // 빠른 검색을 위한 Map들
        const taskMapByCode = new Map<string, number[]>(); // TaskCode -> [Index들]
        
        // 기존 Task들을 맵에 등록
        updatedTaskList.forEach((t, index) => {
          // Task Code로 인덱스 추가
          if (t.taskCode) {
            const key = normalizeTaskCodeKey(t.taskCode);
            if (!taskMapByCode.has(key)) {
              taskMapByCode.set(key, []);
            }
            taskMapByCode.get(key)!.push(index);
          }
        });
        
        // 이번 배치에서 생성된 신규 코드 중복 방지용 Set
        const newCodesInBatch = new Set<string>();

        rows.forEach((row, idx) => {
          const rawAssignee = row[col.assignee];
          const rawTaskName = row[col.task2];

          // 필수값 체크: 담당자와 Task명이 없으면 건너뜀
          if (!rawAssignee || !rawTaskName) {
            console.warn(`Row ${idx + 5}: 담당자(${rawAssignee}) 또는 Task 2(${rawTaskName}) 누락으로 스킵됨.`);
            skipCount++;
            return;
          }

          const rawInputTaskCode = row[col.taskCode] ? String(row[col.taskCode]).trim() : '';
          const inputTaskCode = rawInputTaskCode ? normalizeTaskCodeKey(rawInputTaskCode) : '';
          const taskName = String(rawTaskName).trim();
          const assigneeName = String(rawAssignee).trim();

          const planStart = row[col.planStart] ? String(row[col.planStart]).trim() : todayStr;
          const planEnd = row[col.planEnd] ? String(row[col.planEnd]).trim() : todayStr;
          const actualStart = row[col.actualStart] ? String(row[col.actualStart]).trim() : null;
          const actualEnd = row[col.actualEnd] ? String(row[col.actualEnd]).trim() : null;
          const rawPlanMH = row[col.planMH] != null ? String(row[col.planMH]).trim() : '';
          const rawActualMH = row[col.actualMH] != null ? String(row[col.actualMH]).trim() : '';
          const planMH =
            rawPlanMH === ''
              ? '00.00'
              : (normalizeFlexibleHHMMInput(rawPlanMH) ?? '');
          const actualMH =
            rawActualMH === ''
              ? '00.00'
              : (normalizeFlexibleHHMMInput(rawActualMH) ?? '');

          // ✅ 유효성 검사: O,P(YYYY-MM-DD), S,T(hh.mm)
          if (planStart && !isValidYYYYMMDD(planStart)) {
            errors.push(`행 ${idx + 5}: 계획(시작일) 형식 오류 (YYYY-MM-DD) → "${planStart}"`);
            skipCount++;
            return;
          }
          if (planEnd && !isValidYYYYMMDD(planEnd)) {
            errors.push(`행 ${idx + 5}: 계획(종료일) 형식 오류 (YYYY-MM-DD) → "${planEnd}"`);
            skipCount++;
            return;
          }
          if (rawPlanMH !== '' && (!planMH || !validateHHMM(planMH, true))) {
            errors.push(`행 ${idx + 5}: 계획MH 형식 오류 (hh.mm, mm: 0~60) → "${rawPlanMH}"`);
            skipCount++;
            return;
          }
          if (rawActualMH !== '' && (!actualMH || !validateHHMM(actualMH, true))) {
            errors.push(`행 ${idx + 5}: 실적MH 형식 오류 (hh.mm, mm: 0~60) → "${rawActualMH}"`);
            skipCount++;
            return;
          }
          
          // 진행상태(진척률과 별개) 업로드 반영: 완료/진행중/지연/미시작
          let statusText = row[col.status] ? String(row[col.status]).trim() : '';
          let newStatus: TaskStatus | null = null;
          if (statusText === '완료') newStatus = 'completed';
          else if (statusText === '진행중') newStatus = 'in-progress';
          else if (statusText === '지연') newStatus = 'delayed';
          else if (statusText === '미시작') newStatus = 'not-started';

          // ⚠ 업로드 제외 컬럼(변경 판단/반영 대상 아님): 진척률, 비활성화 여부, 이슈 및 해결방안, 관리자 검토의견
          // const issueText = row[col.issue] ? String(row[col.issue]).trim() : '';
          // const inactiveFlag = col.inactive >= 0 ? parseInactiveFlag(row[col.inactive]) : null;

          // ---------------------------------------------------------
          // [CASE 1] Task Code가 제공된 경우: 해당 Task Code를 가진 모든 Task 업데이트
          // ---------------------------------------------------------
          if (inputTaskCode && taskMapByCode.has(inputTaskCode)) {
            const targetIndices = taskMapByCode.get(inputTaskCode)!;
            
            // 동일 Task Code가 여러 개면 등록구분 Latest(=revisions 길이 최대) 기준으로 1개만 갱신
            const targetIndex = targetIndices.reduce((best, cur) => {
              const bestRev = updatedTaskList[best]?.revisions?.length ?? 0;
              const curRev = updatedTaskList[cur]?.revisions?.length ?? 0;
              return curRev >= bestRev ? cur : best;
            }, targetIndices[0]);
            const targetTask = updatedTaskList[targetIndex];
            const nextReg = incRegistration(targetTask.registration, 'update');
            const dupSameReg = targetIndices.some(i =>
              i !== targetIndex &&
              String(updatedTaskList[i]?.registration ?? '').trim().toUpperCase() === nextReg
            );
            if (dupSameReg) {
              errors.push(`행 ${idx + 5}: Task Code(${rawInputTaskCode}) 등록구분(${nextReg}) 중복으로 업데이트 불가`);
              skipCount++;
              return;
            }

            // ✅ 변경사항 없음이면: 등록구분 증가/이슈기록/수정 모두 하지 않음
            const currentPlan = getCurrentPlan(targetTask);
            const planChanged =
              !isSame(currentPlan.startDate, planStart || null) ||
              !isSame(currentPlan.endDate, planEnd || null) ||
              !isSame(currentPlan.hours, planMH);
            const actualChanged =
              (!!actualStart && !isSame(targetTask.actual?.startDate, actualStart)) ||
              (!!actualEnd && !isSame(targetTask.actual?.endDate, actualEnd)) ||
              (rawActualMH !== '' && !isSame(targetTask.actual?.hours, actualMH));
            const statusChanged = !!newStatus && targetTask.status !== newStatus;
            // 업로드 제외 컬럼(변경 판단/반영 대상 아님): 진척률, 비활성화 여부, 이슈 및 해결방안, 관리자 검토의견
            if (!planChanged && !actualChanged && !statusChanged) {
              noChangeCount++;
              return;
            }
              
              // 실적 데이터 업데이트
              const updatedActual = { ...targetTask.actual };
              if (actualStart) updatedActual.startDate = actualStart;
              if (actualEnd) updatedActual.endDate = actualEnd;
            if (rawActualMH !== '') updatedActual.hours = actualMH;

              // 이슈 추가 (덮어쓰지 않고 추가)
              let updatedIssues = [...targetTask.monthlyIssues];
              // ✅ Task 관리 자동 기록(변경 내역 + 등록구분 병기)
              updatedIssues.push({
                date: todayStr,
                issue: `[Task 관리][${nextReg}] 변경: 계획(${planStart}~${planEnd}, ${planMH}), 실적(${actualStart || ''}~${actualEnd || ''}, ${actualMH}), 상태(${newStatus || targetTask.status})`,
                author: 'System',
                reviewed: false,
                replies: []
              });

              // ✅ Task 관리 업로드: 동일 Task Code면 등록구분 R.n을 올리기 위해 계획(revisions)을 1건 추가
              const newRevision: Revision = {
                revisionDate: todayStr,
                reason: 'Task 관리 업로드',
                period: { startDate: planStart || null, endDate: planEnd || null, hours: planMH }
              };
              const updatedRevisions = [...(targetTask.revisions || []), newRevision];

              // Task 업데이트 적용
              updatedTaskList[targetIndex] = {
                ...targetTask,
                revisions: updatedRevisions,
                registration: nextReg,
                actual: updatedActual,
                monthlyIssues: updatedIssues,
                ...(newStatus ? { status: newStatus } : {})
              };
            
            updateCount += 1;
          }
          // ---------------------------------------------------------
          // [CASE 2] 신규 Task 생성
          // ---------------------------------------------------------
          else {
            // Task Code 결정:
            // - Task Code가 비어있으면 신규 과제 → 자동 채번
            // - 값이 있으면 신규로 그대로 사용(단, 기존에 있으면 위에서 처리됨)
            let finalTaskCode = inputTaskCode;
            // 코드가 없으면 Admin 마스터 기반으로 생성(포맷 포함), 있으면 그대로 사용
            if (!finalTaskCode) {
              const adminCategoryMaster = data.organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
              finalTaskCode = generateTaskCodeForTask2({
                taskName,
                category1: row[col.category1] || '',
                category2: row[col.category2] || '',
                category3: row[col.category3] || '',
                memberInfo: foundMember ? { department: foundMember.department, team: foundMember.team, group: foundMember.group } : null,
                adminCategoryMaster,
                existingTasks: updatedTaskList
              });
              finalTaskCode = normalizeTaskCodeKey(finalTaskCode);
            } else {
              finalTaskCode = normalizeTaskCodeKey(finalTaskCode);
            }
            // 배치 내 중복 체크(최후 보루)
            if (newCodesInBatch.has(finalTaskCode)) {
              const baseCode = `${finalTaskCode}_${String(idx + 1).padStart(3, '0')}`;
              let suffix = 0;
              let tempCode = baseCode;
              while (taskMapByCode.has(tempCode) || newCodesInBatch.has(tempCode)) {
                suffix++;
                tempCode = `${baseCode}_${suffix}`;
              }
              finalTaskCode = tempCode;
            }
            newCodesInBatch.add(finalTaskCode);

            // 담당자 정보 매핑 (조직도 검색)
            let foundMember: any = null;
            outerSearch:
            for (const d of data.organization.departments) { 
              for (const t of d.teams) {
                for (const g of t.groups) {
                  const m = g.members.find(mem => mem.name === assigneeName);
                  if (m) {
                    foundMember = { ...m, group: g.name, team: t.name, department: d.name };
                    break outerSearch;
                  }
                }
              }
            }

            const assigneeId = foundMember ? foundMember.id : `guest_${Date.now()}_${idx}`;

            const isAutoCode = !inputTaskCode; // Task Code 비움(신규) => NR.0
            const newReg = incRegistration(undefined, 'create', isAutoCode ? 'NR' : 'R');
            const existingIdxs = taskMapByCode.get(finalTaskCode) || [];
            const dupSameRegOnCreate = existingIdxs.some(i =>
              String(updatedTaskList[i]?.registration ?? '').trim().toUpperCase() === newReg
            );
            if (dupSameRegOnCreate) {
              errors.push(`행 ${idx + 5}: Task Code(${rawInputTaskCode || finalTaskCode}) 등록구분(${newReg}) 중복으로 신규 등록 불가`);
              skipCount++;
              return;
            }
            const newTask: Task = {
              id: `upload_${Date.now()}_${idx}`,
              taskCode: finalTaskCode,
              category1: row[col.category1] || '',   // *업무구분 1
              category2: row[col.category2] || '',   // *업무구분 2
              category3: row[col.category3] || '',   // Task 1
              name: makeUniqueTask2Name(updatedTaskList, assigneeId, taskName),
              department: foundMember ? foundMember.department : (row[1] || '미지정'),
              team: foundMember ? foundMember.team : (row[2] || '미지정'),
              group: foundMember ? foundMember.group : (row[3] || '미지정'),
              assignee: assigneeId,
              assigneeName: assigneeName,
              createdByRole: (currentUser?.role || 'admin') as UserRole,
              createdVia: 'excel_upload',
              registration: newReg,
              planned: { startDate: planStart, endDate: planEnd, hours: planMH },
              revisions: [],
              actual: { startDate: actualStart, endDate: actualEnd, hours: actualMH },
              monthlyIssues: [
                {
                  date: todayStr,
                  issue: `[Task 관리][${newReg}] 신규 등록`,
                  author: 'System',
                  reviewed: false,
                  replies: []
                },
              ],
              status: newStatus || 'not-started',
              isActive: true
            };

            const newTaskIndex = updatedTaskList.length;
            updatedTaskList.push(newTask);
            
            // 맵에 즉시 반영 (Task Code)
            if (!taskMapByCode.has(finalTaskCode)) {
              taskMapByCode.set(finalTaskCode, []);
            }
            taskMapByCode.get(finalTaskCode)!.push(newTaskIndex);
            
            createCount++;
          }
        });

        if (createCount > 0 || updateCount > 0) {
          setData(prev => ({ ...prev, tasks: updatedTaskList }));
          addNotification(`완료: 신규 ${createCount}건, 업데이트 ${updateCount}건, 변경사항 없음 ${noChangeCount}건 (제외 ${skipCount}건)`, 'success');
          if (errors.length > 0) {
            setUploadErrors(errors);
            setIsErrorModalOpen(true);
          }
        } else if (noChangeCount > 0 && errors.length === 0) {
          addNotification(`변경사항 없음: ${noChangeCount}건`, 'success');
        } else {
          // 상세 원인 안내
          if (skipCount > 0) {
            addNotification(`실패: ${skipCount}건의 데이터가 필수값(담당자/Task명) 누락으로 제외되었습니다. 최신 양식을 확인해주세요.`, 'error');
          } else {
            addNotification('처리할 유효한 데이터가 없습니다.', 'error');
          }
        }

      } catch (error: any) {
        console.error("Upload Error:", error);
        addNotification(`오류 발생: ${error.message}`, 'error');
      }
      setUploadModalOpen(false);
    };
  };
  //2
  //2601080116


  const handleSaveTask = (updatedTask: Task) => { setData(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t) })); setEditModalOpen(false); addNotification('Task 정보가 수정되었습니다.'); };
  const handleUpdateIssues = (updatedTask: Task) => { setData(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t) })); setSelectedTaskForIssues(updatedTask); };

  const handleNavigateToIssue = (task: Task) => {
    setCurrentMainView('taskList');
    setDrillDownIds(new Set([task.id]));
    setSelectedTaskForIssues(task);
    setIssueModalOpen(true);
  };

  const handleGoToMemberDashboard = useCallback((memberId: string) => {
    const info = getMemberInfo(memberId) as any;
    if (!info) return;
    // dashboardScopeTasks 대신 직접 필터링
    let memberTasks = filterTasksByDateRange(data.tasks, filterStartMonth, filterEndMonth);
    memberTasks = memberTasks.filter(task => task.isActive !== false);
    memberTasks = memberTasks.filter(t => t.assignee === memberId);
    if (memberTasks.length === 0) {
      addNotification('해당 담당자의 Task가 없습니다.', 'error');
      return;
    }
    setDrillDownIds(new Set(memberTasks.map(t => t.id)));
    setCurrentMainView('taskList');
  }, [data.tasks, filterStartMonth, filterEndMonth, addNotification, getMemberInfo]);

  const accessibleTasks = useMemo(() => {
    if (!currentUser) return [];
    return getAccessibleTasks(currentUser, data.tasks, data.organization);
  }, [currentUser, data.tasks, data.organization]);

  const filteredTasks = useMemo(() => { 
    let tasks = accessibleTasks;
    if (drillDownIds) {
      tasks = tasks.filter(t => drillDownIds.has(t.id));
    }
    if (!showInactive) tasks = tasks.filter(task => task.isActive !== false); 
    if (excludeCompleted) tasks = tasks.filter(task => task.status !== 'completed');
    if (currentMainView !== 'calendar') { tasks = filterTasksByDateRange(tasks, filterStartMonth, filterEndMonth); }
    if (currentView === 'team') tasks = tasks.filter(task => getTeamMembers(filters.team).includes(task.assignee)); 
    else if (currentView === 'group') tasks = tasks.filter(task => getGroupMembers(filters.team, filters.group).includes(task.assignee)); 
    else if (currentView === 'member') tasks = tasks.filter(task => task.assignee === filters.member); 
    if (statusFilter) {
      if (statusFilter === 'in-progress') { tasks = tasks.filter(task => task.status === 'in-progress' || task.status === 'delayed'); } else { tasks = tasks.filter(task => task.status === statusFilter); }
    }

    // 권한별 필터링: 실장/팀장의 Task 숨김
    if (currentUser) {
      // 그룹장 권한: 실장/팀장의 Task 숨김
      if (currentUser.role === 'group_leader') {
        tasks = tasks.filter(task => {
          const memberInfo = getMemberInfo(task.assignee);
          if (!memberInfo) return true;
          const isDeptHead = memberInfo.role === 'dept_head' || (typeof memberInfo.position === 'string' && memberInfo.position.includes('실장'));
          const isTeamLeader = memberInfo.role === 'team_leader' || (typeof memberInfo.position === 'string' && memberInfo.position.includes('팀장'));
          return !isDeptHead && !isTeamLeader;
        });
      }
      // 팀장 권한: 실장의 Task 숨김
      else if (currentUser.role === 'team_leader') {
        tasks = tasks.filter(task => {
          const memberInfo = getMemberInfo(task.assignee);
          if (!memberInfo) return true;
          const isDeptHead = memberInfo.role === 'dept_head' || (typeof memberInfo.position === 'string' && memberInfo.position.includes('실장'));
          return !isDeptHead;
        });
      }
    }

    // Task 상세 현황: 텍스트 검색
    const query = taskSearchQuery.trim().toLowerCase();
    if (query) {
      const terms = query.split(/\s+/).filter(Boolean);
      const getFields = (t: Task) => ([
        t.taskCode,
        t.category1,
        t.category2,
        t.category3,
        t.name,
        t.assigneeName,
        t.department,
        t.team,
        t.group,
      ].map(v => String(v ?? '').toLowerCase()));

      tasks = tasks.filter(t => {
        const fields = getFields(t);
        return terms.every(term => fields.some(f => f.includes(term)));
      });
    }

    return tasks; 
  }, [accessibleTasks, currentView, filters, statusFilter, showInactive, excludeCompleted, getTeamMembers, getGroupMembers, getMemberInfo, filterStartMonth, filterEndMonth, drillDownIds, currentMainView, taskSearchQuery, currentUser]);

  // 대시보드 집계용 Task 목록: 권한과 무관하게 선택된 뷰(실/팀/그룹/담당자) 범위 전체를 포함
  const dashboardScopeTasks = useMemo(() => {
    let tasks = data.tasks;
    // 대시보드에서도 기간 필터는 동일 적용
    tasks = filterTasksByDateRange(tasks, filterStartMonth, filterEndMonth);
    // ✅ 모든 뷰의 대시보드 집계에서 "비활성(숨김)" Task는 제외
    tasks = tasks.filter(task => task.isActive !== false);
    if (currentView === 'team') tasks = tasks.filter(task => getTeamMembers(filters.team).includes(task.assignee));
    else if (currentView === 'group') tasks = tasks.filter(task => getGroupMembers(filters.team, filters.group).includes(task.assignee));
    else if (currentView === 'member') tasks = tasks.filter(task => task.assignee === filters.member);
    return tasks;
  }, [data.tasks, currentView, filters.team, filters.group, filters.member, filterStartMonth, filterEndMonth, getTeamMembers, getGroupMembers]);

  const sortedAndFilteredTasks = useMemo(() => {
    // ✅ Task 상세 현황: Task Code 중복 시 최신(등록구분/Revision 기준) 1건만 표시
    let sortableItems = dedupeTasksByLatestRegistration(filteredTasks);
    if (sortConfig.length === 0) return sortableItems;
    sortableItems = [...sortableItems];
    sortableItems.sort((a, b) => {
      for (const config of sortConfig) {
        const valA = getTaskPropertyValue(a, config.key);
        const valB = getTaskPropertyValue(b, config.key);
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        let comparison = 0;
        if (valA < valB) comparison = -1;
        else if (valA > valB) comparison = 1;
        if (comparison !== 0) return config.direction === 'asc' ? comparison : -comparison;
      }
      return 0;
    });
    return sortableItems;
  }, [filteredTasks, sortConfig]);
    // [수정] Task 목록 내보내기 (템플릿 양식과 동일한 구조 적용)
  const handleExport = () => {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리가 로드되지 않았습니다.');
      return;
    }

    // 1. 상태 한글 변환 맵
    const statusMap: Record<string, string> = { 
      'not-started': '미시작', 
      'in-progress': '진행중', 
      'delayed': '지연', 
      'completed': '완료' 
    };

    const adminCategoryMaster = data.organization.departments[0]?.teams[0]?.categoryMaster || categoryMasterData;
    const formatTaskCodeForExcel = (code: string) => {
      const raw = String(code || '').trim();
      const m = raw.match(/^([^-]+-[^-]+-[^-]+)-([A-Za-z0-9]+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (!m) return raw;
      const [, org, cat1, a, b, c] = m;
      const aN = parseInt(a, 10), bN = parseInt(b, 10), cN = parseInt(c, 10);
      if ([aN, bN, cN].some(x => Number.isNaN(x))) return raw;
      const pad2 = (n: number) => String(n).padStart(2, '0');
      return `${org}-${cat1}.${pad2(aN)}.${pad2(bN)}.${pad2(cN)}`;
    };
    const getCategory1CodeForExcel = (category1: string) => {
      if (!category1) return '';
      const mapped = (categoryCodeMapping.category1 as any)[category1];
      if (mapped) return mapped;
      const m = category1.match(/\(([^)]+)\)\s*$/);
      if (m?.[1]) return m[1].trim();
      const stripped = category1.replace(/\s*\([^)]*\)\s*$/, '').trim();
      return (categoryCodeMapping.category1 as any)[stripped] || '';
    };
    const getCategory2CodeForExcel = (category1: string, category2: string) => {
      if (!category1 || !category2) return '';
      const cat1Data = adminCategoryMaster[category1] || {};
      const idx = Object.keys(cat1Data).indexOf(category2);
      return idx >= 0 ? String(idx + 1).padStart(2, '0') : '';
    };
    const getTask1CodeForExcel = (category1: string, category2: string, category3: string) => {
      if (!category1 || !category2 || !category3) return '';
      const cat1Data = adminCategoryMaster[category1] || {};
      const cat3List = cat1Data[category2] || [];
      const idx = Array.isArray(cat3List) ? cat3List.indexOf(category3) : -1;
      return idx >= 0 ? String(idx + 1).padStart(2, '0') : '';
    };
    const getTask2CodeForExcel = (taskCode: string) => {
      const parts = String(taskCode || '').split('.');
      const last = parts[parts.length - 1] || '';
      const n = parseInt(last, 10);
      if (Number.isNaN(n)) return '';
      return String(n).padStart(2, '0');
    };
    const getInactiveLabelForExcel = (task: Task) => (task.isActive === false ? 'Y' : 'N');

    // 2. 데이터 변환 (Task 객체 -> 엑셀 행 배열)
    const getRegistrationLabelForExcel = (task: Task) => {
      if (task.registration && String(task.registration).trim()) return task.registration;
      const createdVia = task.createdVia ?? 'unknown';
      if (createdVia === 'manual') return '추가';
      const createdByRole = task.createdByRole ?? 'admin';
      if (createdByRole !== 'admin') return '추가';
      const revisionCount = task.revisions ? task.revisions.length : 0;
      return `R.${revisionCount}`;
    };

    const taskRows = sortedAndFilteredTasks.map(t => {
      const currentPlan = getCurrentPlan(t);
      const planHours = hhmmToNumber(currentPlan.hours);
      const actualHours = hhmmToNumber(t.actual.hours);
      const progress = planHours > 0 
        ? Math.round((actualHours / planHours) * 100) 
        : 0;
      
      // 이슈 텍스트 합치기 (최신순)
      const issueText = t.monthlyIssues.length > 0 
        ? t.monthlyIssues.map(i => `[${i.date}] ${i.issue}`).join('\n') 
        : "";

      return [
        t.id,                           // A: Task ID (Hidden)
        t.department,                   // B: *실
        t.team,                         // C: *팀
        t.group,                        // D: *그룹
        t.assigneeName,                 // E: *담당자
        formatTaskCodeForExcel(t.taskCode), // F: Task Code (표시)
        getCategory1CodeForExcel(t.category1) || "", // G: 업무구분 1 Code (숨김)
        t.category1,                    // H: *업무구분 1
        getCategory2CodeForExcel(t.category1, t.category2) || "", // I: 업무구분 2 Code (숨김)
        t.category2,                    // J: *업무구분 2
        getTask1CodeForExcel(t.category1, t.category2, t.category3) || "", // K: Task 1 Code (숨김)
        t.category3,                    // L: Task 1
        getTask2CodeForExcel(t.taskCode) || "", // M: Task 2 Code (숨김)
        t.name,                         // N: *Task 2
        currentPlan.startDate || "",    // O: *계획(시작일)
        currentPlan.endDate || "",      // P: *계획(종료일)
        t.actual.startDate || "",       // Q: 실적(시작일)
        t.actual.endDate || "",         // R: 실적(종료일)
        currentPlan.hours,              // S: *계획MH
        t.actual.hours,                 // T: 실적MH
        `${progress}%`,                 // U: 진척률
        statusMap[t.status] || t.status,// V: 진행상태
        issueText,                      // W: 이슈 및 해결방안
        "",                             // X: 관리자 검토의견
        getRegistrationLabelForExcel(t), // Y: 등록구분
        getInactiveLabelForExcel(t)      // Z: 비활성화 여부
      ];
    });

    // 3. 전체 데이터 구성 (헤더 + 데이터)
    const wsData = [
      // Row 1: 안내 문구 (템플릿과 모양 맞춤)
      ["Task 목록 내보내기 데이터 (시스템 생성)"],
      // Row 2: 안내 문구
      ["'*' 표시는 필수 관리 항목입니다."],
      // Row 3: 공백
      [],
      // Row 4: 헤더 (이미지 기준으로 변경)
      [
        "Task ID",             // A (Hidden)
        "*실",                 // B
        "*팀",                 // C
        "*그룹",               // D
        "*담당자",             // E
        "Task Code",           // F (표시)
        "업무구분 1 Code",     // G (숨김)
        "*업무구분 1",         // H
        "업무구분 2 Code",     // I (숨김)
        "*업무구분 2",         // J
        "Task 1 Code",         // K (숨김)
        "Task 1",              // L
        "Task 2 Code",         // M (숨김)
        "*Task 2",             // N
        "*계획(시작일)",       // O
        "*계획(종료일)",       // P
        "실적(시작일)",        // Q
        "실적(종료일)",        // R
        "*계획MH\n(hh.mm, mm:00~60)",             // S
        "실적MH\n(hh.mm, mm:00~60)",              // T
        "진척률",              // U
        "진행상태",            // V
        "이슈 및 해결방안",    // W
        "관리자 검토의견",     // X
        "등록구분",            // Y
        "비활성화 여부"        // Z
      ],
      // Row 5~: 실제 데이터
      ...taskRows
    ];

    // 4. 시트 생성
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // O,P(계획 날짜) / S,T(MH) 컬럼을 텍스트로 고정 (표시 일관성)
    // 현재 Task 관리 시트 기준: O=14, P=15, S=18, T=19 (0-based)
    setTextFormatForColumns(ws, [14, 15, 18, 19]);

    // 5. 컬럼 스타일 설정 (너비 및 숨김 - 이미지 기준으로 변경 반영)
    ws['!cols'] = [
      { wch: 20, hidden: true }, // A: Task ID (숨김)
      { wch: 10 },               // B: *실
      { wch: 10 },               // C: *팀
      { wch: 15 },               // D: *그룹
      { wch: 10 },               // E: *담당자
      { wch: 20 },               // F: Task Code (표시)
      { wch: 15, hidden: true }, // G: 업무구분 1 Code (숨김)
      { wch: 15 },               // H: *업무구분 1
      { wch: 15, hidden: true }, // I: 업무구분 2 Code (숨김)
      { wch: 15 },               // J: *업무구분 2
      { wch: 15, hidden: true }, // K: Task 1 Code (숨김)
      { wch: 15 },               // L: Task 1
      { wch: 15, hidden: true }, // M: Task 2 Code (숨김)
      { wch: 35 },               // N: *Task 2
      { wch: 12 },               // O: *계획(시작일)
      { wch: 12 },               // P: *계획(종료일)
      { wch: 12 },               // Q: 실적(시작일)
      { wch: 12 },               // R: 실적(종료일)
      { wch: 15 },               // S: *계획MH (hh.mm 형식 안내 포함)
      { wch: 15 },               // T: 실적MH (hh.mm 형식 안내 포함)
      { wch: 8 },                // U: 진척률
      { wch: 10 },               // V: 진행상태
      { wch: 30 },               // W: 이슈 및 해결방안
      { wch: 20 },               // X: 관리자 검토의견
      { wch: 10 },               // Y: 등록구분
      { wch: 12 }                // Z: 비활성화 여부
    ];

    // 7. 셀 병합 (상단 타이틀) - A~Z = 26개 컬럼, 인덱스 0~25
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 25 } }, 
      { s: { r: 1, c: 0 }, e: { r: 1, c: 25 } }
    ];

    // 8. 파일 저장
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Task 관리");
    const todayStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `tasks_export_${todayStr}.xlsx`);
  };

  const ThSortable = ({
    title,
    sortKey,
    resizingIndex,
    columnIndex,
    onMouseDown,
    hoveredResizeIndex,
    onResizeHover
  }: {
    title: string | React.ReactNode;
    sortKey: SortKey;
    resizingIndex?: number | null;
    columnIndex?: number;
    onMouseDown?: (e: React.MouseEvent, index: number) => void;
    hoveredResizeIndex?: number | null;
    onResizeHover?: (index: number | null) => void;
  }) => {
    const sortIndex = sortConfig.findIndex(c => c.key === sortKey);
    const direction = sortIndex !== -1 ? sortConfig[sortIndex].direction : null;

    const applySort = () => {
      setSortConfig(prev => {
        const existingIndex = prev.findIndex(c => c.key === sortKey);
        const newConfig = [...prev];
        if (existingIndex > -1) {
          if (newConfig[existingIndex].direction === 'asc') newConfig[existingIndex].direction = 'desc';
          else newConfig.splice(existingIndex, 1);
        } else {
          newConfig.push({ key: sortKey, direction: 'asc' });
          if (newConfig.length > 3) newConfig.shift();
        }
        return newConfig;
      });
    };

    return (
      <th style={{ position: 'relative', userSelect: 'none' }} onDoubleClick={applySort}>
        {title}
        {direction && (
          <>
            <span className="sort-indicator">{direction === 'asc' ? '▲' : '▼'}</span>
            {sortConfig.length > 1 && <span className="sort-priority">{sortIndex + 1}</span>}
          </>
        )}
        {columnIndex !== undefined && onMouseDown && (
          <div
            style={{
              position: 'absolute',
              right: '-2px',
              top: 0,
              bottom: 0,
              width: '6px',
              cursor: 'col-resize',
              backgroundColor:
                resizingIndex === columnIndex
                  ? '#007bff'
                  : hoveredResizeIndex === columnIndex
                    ? '#dee2e6'
                    : 'transparent',
              zIndex: 10,
              transition: 'background-color 0.2s'
            }}
            onMouseDown={(e) => onMouseDown(e, columnIndex)}
            onMouseEnter={() => onResizeHover && onResizeHover(columnIndex)}
            onMouseLeave={() => onResizeHover && onResizeHover(null)}
          />
        )}
      </th>
    );
  };

const ViewControls = () => {
    // [수정] 모바일 토글 상태 제거 (항상 펼침) - CSS로 제어
    const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);
    const monthOptions = useMemo(() => { const options = []; for (let y = 2024; y <= 2026; y++) { for (let m = 1; m <= 12; m++) { const val = `${y}-${String(m).padStart(2, '0')}`; const label = `${y}년 ${m}월`; options.push({ value: val, label: label }); } } return options; }, []);
    
    const availableTeams = useMemo(() => {
      const allTeams = data.organization.departments[0].teams;
      if (!currentUser || currentUser.role === 'admin' || currentUser.role === 'dept_head') return allTeams;
      return allTeams.filter(t => t.id === currentUser.teamId);
    }, [data.organization, currentUser]);

    const availableGroups = useMemo(() => {
      const selectedTeam = data.organization.departments[0].teams.find(t => t.id === filters.team);
      if (!selectedTeam) return [];
      if (!currentUser || currentUser.role === 'admin' || currentUser.role === 'dept_head' || currentUser.role === 'team_leader') { return selectedTeam.groups; }
      return selectedTeam.groups.filter(g => g.id === currentUser.groupId);
    }, [data.organization, filters.team, currentUser]);

    const availableMembers = useMemo(() => {
      const selectedTeam = data.organization.departments[0].teams.find(t => t.id === filters.team);
      const selectedGroup = selectedTeam?.groups.find(g => g.id === filters.group);
      if (!selectedGroup) return [];
      if (currentUser && currentUser.role === 'member') { 
          return selectedGroup.members.filter(m => m.id === currentUser.id); 
      }
      return selectedGroup.members;
    }, [data.organization, filters.team, filters.group, currentUser]);

    const currentTeam = data.organization.departments[0].teams.find(t => t.id === filters.team);
    const currentGroup = currentTeam?.groups.find(g => g.id === filters.group);
    
    return (
      <div className="view-controls">
        {/* 1. 뷰 스위처 (좌측) */}
        <div className="view-switcher">
           {(['department', 'team', 'group', 'member'] as const).map(view => (
             <button key={view} className={`view-switcher-btn ${currentView === view ? 'active' : ''}`} onClick={() => setCurrentView(view)}>
               {{
                 department: '실',
                 team: '팀',
                 group: '그룹',
                 member: '담당자',
               }[view]}
             </button>
           ))}
        </div>

        {/* 2. 필터 영역 (중앙~우측) */}
        {/* 모바일 토글 버튼 삭제하고 항상 표시되는 구조로 변경 */}
        <div className="filter-wrapper expanded">
          <div className="filter-section" style={{ display: currentView === 'department' ? 'none' : 'flex' }}> 
            {/* [수정] 돋보기 아이콘(span) 제거하여 공간 확보 */}
            <select id="teamSelect" value={filters.team || ''} onChange={handleFilterChange}>
               <option value="" disabled>팀 선택</option> 
               {availableTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)} 
            </select> 
            
            {(currentView === 'group' || currentView === 'member') && (
              <select id="groupSelect" value={filters.group || ''} onChange={handleFilterChange}> 
                {currentTeam ? (<> 
                  {availableGroups.length === 0 && <option value="" disabled>그룹 없음</option>} 
                  {availableGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)} 
                </>) : (<option value="" disabled>팀 선택 필요</option>)} 
              </select>
            )} 
            
            {currentView === 'member' && (
              <select id="memberSelect" value={filters.member || ''} onChange={handleFilterChange}> 
                {currentGroup ? (<> 
                  {availableMembers.length === 0 && <option value="" disabled>담당자 없음</option>} 
                  {availableMembers.map(member => <option key={member.id} value={member.id}>{`${member.name} ${member.position}`}</option>)} 
                </>) : (<option value="" disabled>그룹 선택 필요</option>)} 
              </select>
            )} 
          </div> 
          
          {currentMainView !== 'calendar' && (
                    <div className="date-range-container">
                      <button
                        type="button"
                        className="date-range-toggle-btn"
                        onClick={() => setIsDateRangeOpen(prev => !prev)}
                        aria-expanded={isDateRangeOpen}
                        title="기간 선택"
                      >
                        기간 ▾
                      </button>
                      <div className={`date-range-group ${isDateRangeOpen ? 'open' : ''}`}> 
              <div className="date-input-wrapper"> 
                <label className="date-label">시작</label> 
                <select className="date-input" value={filterStartMonth} onChange={(e) => setFilterStartMonth(e.target.value)}> 
                  {monthOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)} 
                </select> 
              </div> 
              <div className="date-input-wrapper"> 
                <label className="date-label">종료</label> 
                <select className="date-input" value={filterEndMonth} onChange={(e) => setFilterEndMonth(e.target.value)}> 
                  {monthOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)} 
                </select> 
              </div> 
                      </div> 
                    </div>
          )}
        </div>
      </div>
    );
};

  const Sidebar = () => (
    <nav className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}> 
      <div className="sidebar-header"> {!isSidebarCollapsed && <h2>성과관리</h2>} <button className="sidebar-toggle-btn" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} title={isSidebarCollapsed ? "메뉴 펼치기" : "메뉴 접기"}> {isSidebarCollapsed ? '▶' : '◀'} </button> </div> 
      <ul className="sidebar-nav"> 
        <li className={currentMainView === 'dashboard' ? 'active' : ''}><a href="#" onClick={(e) => { e.preventDefault(); setDrillDownIds(null); setCurrentMainView('dashboard'); }} title="대시보드"><span className="nav-icon">📊</span><span className="nav-text">대시보드</span></a></li> 
        <li className={currentMainView === 'taskList' ? 'active' : ''}><a href="#" onClick={(e) => { e.preventDefault(); setDrillDownIds(null); setCurrentMainView('taskList'); }} title="Task 목록"><span className="nav-icon">📋</span><span className="nav-text">Task 목록</span></a></li> 
        <li className={currentMainView === 'calendar' ? 'active' : ''}><a href="#" onClick={(e) => { e.preventDefault(); setDrillDownIds(null); setCurrentMainView('calendar'); }} title="Calendar"><span className="nav-icon">🗓️</span><span className="nav-text">Calendar</span></a></li> 
        {currentUser?.role === 'admin' && (<li className={currentMainView === 'admin' ? 'active' : ''}><a href="#" onClick={(e) => { e.preventDefault(); setDrillDownIds(null); setCurrentMainView('admin'); }} title="Admin"><span className="nav-icon">⚙️</span><span className="nav-text">Admin</span></a></li>)}
      </ul> 
    </nav>
  );

  const DashboardView = () => {
    const dashboardBaseTasks = dashboardScopeTasks;
    const targetYear = parseInt(filterStartMonth.split('-')[0]) || new Date().getFullYear();
    const handleGoToTeam = (teamId: string) => {
      const team = data.organization.departments[0].teams.find(t => t.id === teamId);
      if (!team) return;
      const teamTasks = dashboardBaseTasks.filter(t => t.team === team.name);
      if (teamTasks.length === 0) {
        addNotification('해당 팀의 Task가 없습니다.', 'error');
        return;
      }
      setDrillDownIds(new Set(teamTasks.map(t => t.id)));
      setCurrentMainView('taskList');
    };

    const handleGoToGroup = (groupId: string) => {
      const team = data.organization.departments[0].teams.find(t => t.id === filters.team);
      if (!team) return;
      const group = team.groups.find(g => g.id === groupId);
      if (!group) return;
      const groupTasks = dashboardBaseTasks.filter(t => t.group === group.name);
      if (groupTasks.length === 0) {
        addNotification('해당 그룹의 Task가 없습니다.', 'error');
        return;
      }
      setDrillDownIds(new Set(groupTasks.map(t => t.id)));
      setCurrentMainView('taskList');
    };

    // ✅ 실(Department) 대시보드 집계: 모든 팀원 과제 기준(기간만 적용, 활성/비활성 포함)
    const divisionDashboardTasks = filterTasksByDateRange(data.tasks, filterStartMonth, filterEndMonth);
    if (currentView === 'department') return <DivisionDashboard data={data} tasks={divisionDashboardTasks} targetYear={targetYear} onGoToTeam={handleGoToTeam} />;
    if (currentView === 'team') { const selectedTeam = data.organization.departments[0].teams.find(t => t.id === filters.team); const teamTasks = dashboardBaseTasks.filter(t => t.team === selectedTeam?.name); if (selectedTeam) return <TeamDashboard team={selectedTeam} tasks={teamTasks} targetYear={targetYear} onGoToGroup={handleGoToGroup} />; }
    if (currentView === 'group') {
      const selectedTeam = data.organization.departments[0].teams.find(t => t.id === filters.team);
      const selectedGroup = selectedTeam?.groups.find(g => g.id === filters.group);
      const groupTasks = dashboardBaseTasks.filter(t => t.group === selectedGroup?.name);
      if (selectedGroup) {
        return (
          <GroupDashboard
            group={selectedGroup}
            tasks={groupTasks}
            targetYear={targetYear}
            currentUser={currentUser}
            onDrillDown={handleDrillDown}
            onNavigateToIssue={handleNavigateToIssue}
            onGoToMemberDashboard={handleGoToMemberDashboard}
          />
        );
      }
    }
    if (currentView === 'member') { const selectedTeam = data.organization.departments[0].teams.find(t => t.id === filters.team); const selectedGroup = selectedTeam?.groups.find(g => g.id === filters.group); const selectedMember = selectedGroup?.members.find(m => m.id === filters.member); const memberTasks = dashboardBaseTasks.filter(t => t.assignee === selectedMember?.id); return ( <MemberDashboardV2 tasks={memberTasks} startMonth={filterStartMonth} endMonth={filterEndMonth} onDrillDown={handleDrillDown} onNavigateToIssue={handleNavigateToIssue} /> ); }
    return null;
  };

  const TaskListView = () => {
    // ✅ Task Code 컬럼 분리 (총 14개 컬럼)
    const columnWidths = taskTableColumnWidths;
    const setColumnWidths = setTaskTableColumnWidths;
    // ✅ 비활성화 컬럼은 항상 표시(우측에 Task Code도 함께 표시)
    const showToggleColumn = true;
    const visibleColumnWidths = columnWidths;
    // ✅ 검색 입력은 로컬 상태로 유지하여 Key-in 시 App 전체 리렌더/리마운트 방지 (커서 유지)
    const [taskSearchInput, setTaskSearchInput] = useState(taskSearchQuery);
    const [resizingIndex, setResizingIndex] = useState<number | null>(null);
    const [hoveredResizeIndex, setHoveredResizeIndex] = useState<number | null>(null);
    const resizeStartRef = useRef<{ x: number; widths: number[] } | null>(null);
    const tableScrollRef = useRef<HTMLDivElement | null>(null);
    const lastScrollPosRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 });
    const savedScrollPosRef = useRef<{ top: number; left: number } | null>(null); // 버튼 클릭 시점의 위치
    const isRestoringRef = useRef<boolean>(false); // 복원 중 플래그
    const restoreTimeoutRef = useRef<NodeJS.Timeout | null>(null); // 복원 타이머 참조
    
    const captureTableScroll = useCallback(() => {
      const el = tableScrollRef.current;
      if (!el) return;
      // 버튼 클릭 시점의 스크롤 위치를 별도로 저장 (복원용)
      // 이전 복원 타이머가 있으면 취소
      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }
      savedScrollPosRef.current = { top: el.scrollTop, left: el.scrollLeft };
      // 현재 위치도 업데이트
      lastScrollPosRef.current = { top: el.scrollTop, left: el.scrollLeft };
    }, []);
    
    // 상태 업데이트 후 스크롤 복원 헬퍼
    const restoreScrollAfterUpdate = useCallback(() => {
      // 복원할 위치가 없으면 복원하지 않음
      const savedPos = savedScrollPosRef.current;
      if (!savedPos) return;
      
      // 이미 복원 중이면 중복 실행 방지
      if (isRestoringRef.current) return;
      
      isRestoringRef.current = true;
      
      // 이전 복원 타이머가 있으면 취소
      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current);
      }
      
      // DOM 업데이트를 기다린 후 복원 (더 안정적인 타이밍)
      restoreTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = tableScrollRef.current;
            if (!el) {
              isRestoringRef.current = false;
              restoreTimeoutRef.current = null;
              return;
            }
            
            const { top, left } = savedPos;
            const currentTop = el.scrollTop;
            const currentLeft = el.scrollLeft;
            
            // 저장된 위치와 현재 위치가 다르면 복원 (1px 이상 차이)
            const shouldRestoreTop = Math.abs(currentTop - top) > 1;
            const shouldRestoreLeft = Math.abs(currentLeft - left) > 1;
            
            if (shouldRestoreTop || shouldRestoreLeft) {
              // 복원 실행
              if (shouldRestoreTop) {
                el.scrollTop = top;
              }
              if (shouldRestoreLeft) {
                el.scrollLeft = left;
              }
              // 복원 후 현재 위치 업데이트
              lastScrollPosRef.current = { top: el.scrollTop, left: el.scrollLeft };
            } else {
              // 복원이 필요 없으면 저장된 위치 초기화 (다음 버튼 클릭까지 유지하지 않음)
              savedScrollPosRef.current = null;
            }
            
            // 복원 완료 후 플래그 해제 (onScroll 이벤트가 처리되도록 짧은 지연)
            setTimeout(() => {
              isRestoringRef.current = false;
              restoreTimeoutRef.current = null;
            }, 10);
          });
        });
      }, 0);
    }, []);

    useEffect(() => {
      // 외부에서 query가 바뀐 경우(예: 초기화) 입력값 동기화
      setTaskSearchInput(taskSearchQuery);
    }, [taskSearchQuery]);

    const handleMouseDown = (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      const tableElement = document.querySelector('.table-responsive table');
      if (!tableElement) return;
      
      setResizingIndex(index);
      resizeStartRef.current = {
        x: e.clientX,
        widths: [...columnWidths]
      };
      
      // 전체 페이지에 리사이즈 커서 적용
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
      if (resizingIndex === null || !resizeStartRef.current) return;
      
      const deltaX = e.clientX - resizeStartRef.current.x;
      const tableElement = document.querySelector('.table-responsive table');
      if (!tableElement) return;
      
      const tableWidth = tableElement.clientWidth;
      if (tableWidth === 0) return; // 테이블 너비가 0이면 리턴
      
      const deltaPercent = (deltaX / tableWidth) * 100;
      
      setColumnWidths(prev => {
        if (!resizeStartRef.current) return prev;
        
        const newWidths = [...prev];
        const startWidths = resizeStartRef.current.widths;
        
        // 인덱스 범위 체크
        if (resizingIndex < 0 || resizingIndex >= newWidths.length || resizingIndex >= startWidths.length) {
          return prev;
        }
        
        const startWidth = startWidths[resizingIndex];
        const newWidth = Math.max(3, Math.min(30, startWidth + deltaPercent));
        const widthDiff = newWidth - startWidth;
        newWidths[resizingIndex] = newWidth;
        
        // 다음 열 너비 조정 (전체 합이 100%가 되도록)
        if (resizingIndex < newWidths.length - 1) {
          const nextIndex = resizingIndex + 1;
          if (nextIndex < startWidths.length) {
            const nextStartWidth = startWidths[nextIndex];
            const nextWidth = Math.max(3, nextStartWidth - widthDiff);
            newWidths[nextIndex] = nextWidth;
          }
        }
        
        return newWidths;
      });
    }, [resizingIndex]);

    const handleMouseUp = useCallback(() => {
      if (resizingIndex !== null) {
        setResizingIndex(null);
        resizeStartRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }, [resizingIndex]);

    useEffect(() => {
      if (resizingIndex !== null) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mouseleave', handleMouseUp); // 마우스가 화면 밖으로 나갈 때도 처리
        return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
          document.removeEventListener('mouseleave', handleMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };
      }
    }, [resizingIndex, handleMouseMove, handleMouseUp]);

    // ✅ 어떤 버튼/필터를 눌러도 테이블 스크롤이 상단으로 튀지 않도록 복원
    // 상태 변경 후 스크롤 복원 (버튼 클릭 시점의 저장된 위치로 복원)
    useLayoutEffect(() => {
      // savedScrollPosRef에 저장된 위치가 있으면 복원 시도
      // 단, 복원 중이 아닐 때만 실행 (중복 방지)
      if (savedScrollPosRef.current && !isRestoringRef.current) {
        // DOM이 완전히 업데이트될 때까지 대기 후 복원
        // tableBody가 useMemo로 재생성되면서 ref가 새 DOM에 연결되는 것을 고려
        const savedPos = savedScrollPosRef.current;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = tableScrollRef.current;
            if (el && savedScrollPosRef.current === savedPos) {
              // ref가 새 DOM에 연결되었을 수 있으므로 즉시 복원
              if (el.scrollTop === 0 && savedPos.top > 0) {
                el.scrollTop = savedPos.top;
              }
              if (el.scrollLeft === 0 && savedPos.left > 0) {
                el.scrollLeft = savedPos.left;
              }
              // 추가로 restoreScrollAfterUpdate도 호출 (더 정확한 복원)
              restoreScrollAfterUpdate();
            }
          });
        });
      }
    }, [statusFilter, showInactive, excludeCompleted, taskSearchQuery, sortedAndFilteredTasks.length, restoreScrollAfterUpdate]);
    
    // ✅ 모달이 열릴 때도 스크롤 위치 유지 (모달 상태 변경 감지)
    // useLayoutEffect에서 이미 복원을 시도하므로, 여기서는 추가 보완만 수행
    useEffect(() => {
      if (isEditModalOpen || isIssueModalOpen || isRevisionModalOpen) {
        // 모달이 열린 후 약간의 지연을 두고 복원 시도 (DOM 완전 업데이트 대기)
        // 단, 복원 중이 아니고 저장된 위치가 있을 때만
        const timer = setTimeout(() => {
          if (savedScrollPosRef.current && !isRestoringRef.current) {
            restoreScrollAfterUpdate();
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [isEditModalOpen, isIssueModalOpen, isRevisionModalOpen, restoreScrollAfterUpdate]);

    const tableBody = useMemo(() => (
      <div
        className="table-responsive"
        ref={tableScrollRef}
        onScroll={(e) => {
          // 복원 중이 아닐 때만 위치 저장 (복원 중에는 저장하지 않아서 충돌 방지)
          // 사용자가 직접 스크롤한 경우에만 위치 업데이트
          if (!isRestoringRef.current) {
            const newTop = e.currentTarget.scrollTop;
            const newLeft = e.currentTarget.scrollLeft;
            lastScrollPosRef.current = { top: newTop, left: newLeft };
            // 사용자가 스크롤하면 저장된 복원 위치는 무효화 (의도하지 않은 복원 방지)
            // 단, 저장된 위치와 현재 위치가 같으면 유지 (복원이 성공한 경우)
            if (savedScrollPosRef.current) {
              const { top: savedTop, left: savedLeft } = savedScrollPosRef.current;
              const isSamePosition = Math.abs(newTop - savedTop) <= 1 && Math.abs(newLeft - savedLeft) <= 1;
              if (!isSamePosition) {
                // 사용자가 다른 위치로 스크롤했으면 저장된 위치 초기화
                savedScrollPosRef.current = null;
              }
            }
          }
        }}
      >
            <table> 
              <colgroup> 
                {visibleColumnWidths.map((width, idx) => (
                  <col key={idx} style={{ width: `${width}%` }} />
                ))}
              </colgroup> 
              <thead className="sticky-thead">
                <tr> 
                  <th style={{ position: 'relative', userSelect: 'none' }}>
                    관리
                    <div 
                      style={{
                        position: 'absolute',
                        right: '-2px',
                        top: 0,
                        bottom: 0,
                        width: '6px',
                        cursor: 'col-resize',
                        backgroundColor: resizingIndex === 0 ? '#007bff' : (hoveredResizeIndex === 0 ? '#dee2e6' : 'transparent'),
                        zIndex: 10,
                        transition: 'background-color 0.2s'
                      }}
                      onMouseDown={(e) => handleMouseDown(e, 0)}
                      onMouseEnter={() => setHoveredResizeIndex(0)}
                      onMouseLeave={() => setHoveredResizeIndex(null)}
                    />
                  </th>
                  <ThSortable title="이슈 관리" sortKey="issues" resizingIndex={resizingIndex} columnIndex={1} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                  <ThSortable title="업무 구분 1" sortKey="category1" resizingIndex={resizingIndex} columnIndex={2} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} /> 
                  <ThSortable title="업무 구분 2" sortKey="category2" resizingIndex={resizingIndex} columnIndex={3} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                  <ThSortable title="Task 1" sortKey="category3" resizingIndex={resizingIndex} columnIndex={4} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                  <ThSortable title="Task 2" sortKey="name" resizingIndex={resizingIndex} columnIndex={5} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} /> 
                  <ThSortable title="담당자" sortKey="assigneeName" resizingIndex={resizingIndex} columnIndex={6} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} /> 
                  <ThSortable title="계획" sortKey="planned" resizingIndex={resizingIndex} columnIndex={7} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} /> 
                  <ThSortable title="실적" sortKey="actual" resizingIndex={resizingIndex} columnIndex={8} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} /> 
                  <ThSortable title="진척률" sortKey="status" resizingIndex={resizingIndex} columnIndex={9} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} /> 
                  <ThSortable title="진행상태" sortKey="status" resizingIndex={resizingIndex} columnIndex={10} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                  <ThSortable title="등록구분" sortKey="registration" resizingIndex={resizingIndex} columnIndex={11} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                  <ThSortable title="비활성화" sortKey="active" resizingIndex={resizingIndex} columnIndex={12} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                  <ThSortable title="Task Code" sortKey="taskCode" resizingIndex={resizingIndex} columnIndex={13} onMouseDown={handleMouseDown} hoveredResizeIndex={hoveredResizeIndex} onResizeHover={setHoveredResizeIndex} />
                </tr>
              </thead> 
              <tbody> 
                {sortedAndFilteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="table-empty-state">
                      <div className="empty-state-content">
                        <span>📭</span>
                        <p>표시할 Task가 없습니다.</p>
                        <small>필터를 조정하거나 새로운 Task를 추가해주세요.</small>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedAndFilteredTasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      canEdit={canEditTaskForUser(task)}
                      canToggleActive={canToggleActiveForUser(task)}
                      showToggleColumn={showToggleColumn}
                      onEdit={(t) => { 
                        // 스크롤 위치를 먼저 저장
                        captureTableScroll(); 
                        // 상태 업데이트를 지연시켜 스크롤 복원이 먼저 실행되도록 함
                        requestAnimationFrame(() => {
                          handleEdit(t);
                        });
                      }}
                      onOpenIssueModal={() => {
                        captureTableScroll();
                        // 상태 업데이트를 지연시켜 스크롤 복원이 먼저 실행되도록 함
                        requestAnimationFrame(() => {
                          setSelectedTaskForIssues(task);
                          setIssueModalOpen(true);
                        });
                      }}
                      onToggleActive={(id, isActive) => { captureTableScroll(); handleToggleActive(id, isActive); }}
                      onOpenRevisionModal={(t) => {
                        captureTableScroll();
                        // 상태 업데이트를 지연시켜 스크롤 복원이 먼저 실행되도록 함
                        requestAnimationFrame(() => {
                          setSelectedTaskForRevision(t);
                          setRevisionModalOpen(true);
                        });
                      }}
                    />
                  ))
                )} 
              </tbody> 
            </table> 
      </div>
    ), [
      sortedAndFilteredTasks,
      showInactive,
      excludeCompleted,
      statusFilter,
      resizingIndex,
      hoveredResizeIndex,
      visibleColumnWidths,
      handleMouseDown,
      canEditTaskForUser,
      canToggleActiveForUser,
      handleEdit,
      setSelectedTaskForIssues,
      setIssueModalOpen,
      handleToggleActive,
      setSelectedTaskForRevision,
      setRevisionModalOpen,
      setDrillDownIds
    ]);

    return (
      <> 
        {drillDownIds && (<div className="drilldown-banner"> <span>🔍 대시보드에서 선택된 <strong>{drillDownIds.size}</strong>개의 Task를 조회 중입니다.</span> <button className="btn btn-sm btn-secondary" onClick={() => { captureTableScroll(); setDrillDownIds(null); }}>전체 목록 보기</button> </div>)} 
        <div className="task-table sticky-table-layout"> 
          <div className="table-header sticky-control-bar"> 
            <h2 className="chart-title">Task 상세 현황 <span className="task-count-badge">{sortedAndFilteredTasks.length}</span></h2> 

            <div className="table-controls" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'nowrap', justifyContent: 'flex-end', marginLeft: '0', overflowX: 'auto', maxWidth: '100%' }}> 
              {!drillDownIds && (
                <> 
                  {/* 검색 영역: table-controls 왼쪽에 배치 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '10px' }}>
                    <div className="task-search" title="Task 검색" style={{ flex: '0 1 179px', maxWidth: '179px' }}>
                      <input
                        className="task-search-input"
                        value={taskSearchInput}
                        onChange={(e) => setTaskSearchInput(e.target.value)}
                        placeholder="검색 (업무구분/Task명/담당자/코드)"
                        aria-label="Task 검색"
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setTaskSearchInput('');
                            setTaskSearchQuery('');
                          }
                        }}
                      />
                      {taskSearchInput.trim() !== '' && (
                        <button
                          className="task-search-clear"
                          type="button"
                          onClick={() => { captureTableScroll(); setTaskSearchInput(''); setTaskSearchQuery(''); }}
                          aria-label="검색어 지우기"
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary task-search-apply"
                      onClick={() => { captureTableScroll(); setTaskSearchQuery(taskSearchInput); }}
                      style={{ padding: '0 8px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    >
                      검색
                    </button>
                  </div>
                  
                  <div className="table-controls-left" style={{ display: 'flex', gap: '10px', alignItems: 'center', marginRight: '10px' }}>
                    <label className="checkbox-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', alignSelf: 'center', fontSize: '0.9rem', height: '19px', lineHeight: '19px', margin: 0, padding: 0 }}>
                      <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={e => { captureTableScroll(); setShowInactive(e.target.checked); }}
                        style={{ marginRight: '5px' }}
                      />
                      비활성 포함
                    </label> 
                    <label className="checkbox-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', alignSelf: 'center', fontSize: '0.9rem', height: '19px', lineHeight: '19px', margin: 0, padding: 0 }}>
                      <input
                        type="checkbox"
                        checked={excludeCompleted}
                        onChange={(e) => { captureTableScroll(); handleExcludeCompletedChange(e as any); }}
                        style={{ marginRight: '5px' }}
                      />
                      완료 제외
                    </label>
                  </div>
                  <div className="status-filter-buttons" style={{ display: 'flex', backgroundColor: '#f1f3f5', padding: '4px', borderRadius: '6px' }}>
                    {[{ value: '', label: '전체' }, { value: 'in-progress', label: '진행중' }, { value: 'delayed', label: '지연' }, { value: 'not-started', label: '미시작' }, { value: 'completed', label: '완료' }].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => { captureTableScroll(); setStatusFilter(opt.value); }}
                        style={{ padding: '5px 12px', border: 'none', backgroundColor: statusFilter === opt.value ? '#ffffff' : 'transparent', color: statusFilter === opt.value ? '#222' : '#868e96', fontWeight: statusFilter === opt.value ? 'bold' : 'normal', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', boxShadow: statusFilter === opt.value ? '0 1px 2px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.2s ease' }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )} 

              <div className="action-buttons-container">
                <button className="btn btn-primary action-btn" onClick={() => { captureTableScroll(); setDailyModalOpen(true); }}>
                  <span className="btn-icon">⏱️</span>
                  <span className="btn-text">시수 입력</span>
                </button>
                <button className="btn btn-secondary action-btn" onClick={() => { captureTableScroll(); handleExport(); }}>
                  <span className="btn-icon">📥</span>
                  <span className="btn-text">내보내기</span>
                </button>
                <button className="btn btn-primary action-btn" onClick={() => { captureTableScroll(); handleOpenTaskModal(); }}>
                  <span className="btn-icon">➕</span>
                  <span className="btn-text">Task 등록</span>
                </button>
              </div>
            </div> 
          </div>

          {tableBody}
        </div>
      </>
    );
  };

// [수정] CalendarView: viewMode 상태 추가 및 정렬/필터링 로직 개선
// [수정] CalendarView: 뷰 모드에 따라 정렬/필터링 로직 수행
// [중요 수정] CalendarView: 뷰 모드(활성/전체) 도입 및 정렬 로직 개선
const CalendarView = ({ tasks, currentDate, setCurrentDate, onTaskClick, onDrillDown }: { tasks: Task[], currentDate: Date, setCurrentDate: (date: Date) => void, onTaskClick: (task: Task) => void, onDrillDown: (tasks: Task[]) => void }) => {
  // 1. 숨김 처리된 과제 ID 목록 관리
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>([]);
  // 2. 숨김 목록 팝업 표시 여부
  const [showHiddenList, setShowHiddenList] = useState(false);
  
  // 팝업 외부 클릭 감지를 위한 ref
  const hiddenListRef = useRef<HTMLDivElement>(null);
  const hiddenListButtonRef = useRef<HTMLButtonElement>(null);
  
  // 기존 viewMode state 유지
  const [viewMode, setViewMode] = useState<'active' | 'all'>('active');
  
  // 외부 클릭 감지: 팝업이 열려있을 때 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showHiddenList && 
          hiddenListRef.current && 
          hiddenListButtonRef.current &&
          !hiddenListRef.current.contains(event.target as Node) &&
          !hiddenListButtonRef.current.contains(event.target as Node)) {
        setShowHiddenList(false);
      }
    };

    if (showHiddenList) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHiddenList]);

  // 3. 숨김 해제(복구) 함수
  const handleRestore = (idToRestore: string) => {
    setHiddenTaskIds(prev => prev.filter(id => id !== idToRestore));
  };

  // 4. (팝업용) 숨겨진 Task 객체 찾기
  const hiddenTasksList = tasks.filter(t => hiddenTaskIds.includes(t.id));
  // 'active': 활성 일정만 표시 (숨김 제거)
  // 'all': 전체 표시 (숨김 항목은 하단 정렬 + 흐림 처리) 

  const stats = useMemo(() => {
    // 통계는 뷰 모드와 상관없이 전체 기준 (혹은 활성 기준? 여기선 전체로 유지)
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    let workingDays = 0; let holidays = 0;
    for (let d = 1; d <= daysInMonth; d++) { const dateObj = new Date(year, month, d); const dayOfWeek = dateObj.getDay(); const dateStr = dateObj.toISOString().split('T')[0]; if (dayOfWeek === 0 || dayOfWeek === 6 || koreanHolidays.has(dateStr)) holidays++; else workingDays++; }
    const totalCapacity = workingDays * 8; 
    let regularActual = 0; let holidayActual = 0; 
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    tasks.forEach(task => { if (task.dailyLogs) { Object.entries(task.dailyLogs).forEach(([dateStr, hours]) => { if (dateStr.startsWith(monthPrefix)) { const logDate = new Date(dateStr); const dayOfWeek = logDate.getDay(); const hoursNum = hhmmToNumber(hours); if (dayOfWeek === 0 || dayOfWeek === 6 || koreanHolidays.has(dateStr)) holidayActual += hoursNum; else regularActual += hoursNum; } }); } });
    return { totalCapacity, regularActual, holidayActual, totalActual: regularActual + holidayActual };
  }, [currentDate, tasks]);

  // [수정 2] calendarData useMemo 내부 수정

  // ✅ 월 단위 "lane" 배치:
  // - 동일 과제(동일 taskCode 기준)는 좌우(주/일) 이동에도 같은 높이 유지
  // - 종료 이후에는 해당 높이를 비워두고(공백), 새 과제가 시작되면 빈 lane 재사용
  // - 월이 바뀌면 lane 재배치 가능(=월 단위로 재계산)
  const calendarData = useMemo(() => { 
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDayOfMonth = new Date(year, month, 1);
      const lastDayOfMonth = new Date(year, month + 1, 0);

      const daysInGrid: Date[] = [];
      const startDate = new Date(firstDayOfMonth);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      const endDate = new Date(lastDayOfMonth);
      if (endDate.getDay() !== 6) endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
      let current = new Date(startDate);
      while (current <= endDate) { daysInGrid.push(new Date(current)); current.setDate(current.getDate() + 1); }

      const gridStartKey = startDate.toISOString().split('T')[0];
      const gridEndKey = endDate.toISOString().split('T')[0];

      // 중복 taskCode는 최신 1건만 사용(캘린더 lane 안정화)
      const baseTasks = dedupeTasksByLatestRegistration(tasks);

      // 뷰 모드에 따른 후보 (숨김은 lane을 유지하기 위해 여기서 제외하지 않음)
      const candidateTasks = (viewMode === 'active'
        ? baseTasks.filter(t => t.isActive !== false)
        : baseTasks
      ).filter(t => {
        const plan = getCurrentPlan(t);
        if (!plan.startDate || !plan.endDate) return false;
        // grid 범위와 겹치는 일정만
        return !(plan.endDate < gridStartKey || plan.startDate > gridEndKey);
      });

      type Interval = { task: Task; start: string; end: string };
      const intervals: Interval[] = candidateTasks.map(t => {
        const plan = getCurrentPlan(t);
        return { task: t, start: plan.startDate!, end: plan.endDate! };
      }).sort((a, b) => {
        if (a.start !== b.start) return a.start.localeCompare(b.start);
        const aCode = (a.task.taskCode || '').localeCompare(b.task.taskCode || '');
        if (aCode !== 0) return aCode;
        return (a.task.name || '').localeCompare(b.task.name || '');
      });

      // lane 할당(인터벌 컬러링)
      const laneEnds: string[] = [];
      const laneByTaskId = new Map<string, number>();
      intervals.forEach(({ task, start, end }) => {
        let lane = laneEnds.findIndex(prevEnd => prevEnd < start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(end);
        } else {
          laneEnds[lane] = end;
        }
        laneByTaskId.set(task.id, lane);
      });
      const laneCount = laneEnds.length;

      // day -> lane array(Task|null)
      const tasksByDay: Map<string, Array<Task | null>> = new Map();
      daysInGrid.forEach(day => {
        const dayKey = day.toISOString().split('T')[0];
        const lanes: Array<Task | null> = new Array(laneCount).fill(null);
        intervals.forEach(({ task, start, end }) => {
          if (dayKey < start || dayKey > end) return;
          const lane = laneByTaskId.get(task.id);
          if (lane === undefined) return;
          lanes[lane] = task;
        });
        tasksByDay.set(dayKey, lanes);
      });

      return { daysInGrid, tasksByDay, currentMonth: month, laneCount }; 
  }, [currentDate, tasks, viewMode]); 

  const handlePrevMonth = () => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)); };
  const handleNextMonth = () => { setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)); };
  const handleToday = () => { setCurrentDate(new Date()); };
  
  // 토글 핸들러
  const toggleViewMode = () => { setViewMode(prev => prev === 'active' ? 'all' : 'active'); };
  const handleGoToList = (e: React.MouseEvent, dayTasks: Task[]) => { e.stopPropagation(); onDrillDown(dayTasks); };
  const todayKey = new Date().toISOString().split('T')[0];

  return (
    <> 
      {/* 1. 상단 통계 카드 (기존 유지) */}
      <div className="calendar-stats-container">
        <div className="cal-stat-card blue"><span className="cal-stat-label">📅 금월 표준 근로 가능</span><span className="cal-stat-value">{stats.totalCapacity.toLocaleString()}h</span><span className="cal-stat-sub">평일 8H 기준</span></div>
        <div className="cal-stat-card green"><span className="cal-stat-label">✅ 금월 현재 실적 (평일)</span><span className="cal-stat-value" style={{ color: '#1cc88a' }}>{stats.regularActual.toFixed(1)}h</span><span className="cal-stat-sub">진척률 {stats.totalCapacity > 0 ? ((stats.regularActual / stats.totalCapacity) * 100).toFixed(1) : 0}%</span></div>
        <div className="cal-stat-card orange"><span className="cal-stat-label">🚀 휴일/주말 근무</span><span className="cal-stat-value" style={{ color: '#f6c23e' }}>{stats.holidayActual.toFixed(1)}h</span><span className="cal-stat-sub">초과 근로</span></div>
        <div className="cal-stat-card purple"><span className="cal-stat-label">📊 총 투입 시수</span><span className="cal-stat-value" style={{ color: '#6f42c1' }}>{stats.totalActual.toFixed(1)}h</span><span className="cal-stat-sub">전체 합계</span></div>
      </div>
      
      <div className={`calendar-view ${viewMode === 'all' ? 'calendar-expanded' : 'calendar-compact'}`}> 
        {/* 2. 캘린더 헤더 (년/월 이동) + 우측 컨트롤바 */}
        <div className="calendar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}> 
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
            <button onClick={handlePrevMonth} className="calendar-nav-btn">‹</button> 
            <h2 className="calendar-title">{currentDate.getFullYear()}년 {currentDate.toLocaleString('default', { month: 'long' })}</h2> 
            <button onClick={handleToday} className="calendar-today-btn" title="오늘 날짜로 이동">오늘</button>
            <button onClick={handleNextMonth} className="calendar-nav-btn">›</button> 
          </div>
          
          {/* 우측 컨트롤바: 숨김 관리 + 뷰 모드 토글 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', position: 'relative' }}>
           
           {/* (A) 숨김 목록 토글 버튼 */}
           <button 
             ref={hiddenListButtonRef}
             onClick={() => setShowHiddenList(!showHiddenList)}
             style={{ 
               background: showHiddenList ? '#ffebee' : 'white', 
               border: '1px solid #ffcdd2', 
               borderRadius: '20px',
               padding: '6px 16px',
               color: '#d32f2f',
               cursor: 'pointer', 
               fontWeight: 'bold',
               display: 'flex', alignItems: 'center', gap: '6px',
               fontSize: '0.9rem',
               boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
             }}
           >
               <span>👁️ 전체 일정</span>
               {hiddenTaskIds.length > 0 && (
                 <span style={{ background: '#d32f2f', color: 'white', borderRadius: '10px', padding: '0 6px', fontSize: '0.75rem' }}>
                   {hiddenTaskIds.length}
                 </span>
               )}
           </button>

           {/* (B) 뷰 모드 버튼 (전체/활성) */}
           <button 
             onClick={toggleViewMode} 
             style={{ 
               background: 'white', border: '1px solid #ddd', borderRadius: '20px', padding: '6px 16px',
               color: viewMode === 'all' ? '#495057' : '#0d6efd',
               cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem',
               boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
             }}
           >
               {viewMode === 'all' ? '▽ 최소화 일정' : '△ 활성 일정'}
           </button>

           {/* (C) 숨김 목록 팝업 */}
           {showHiddenList && (
             <div ref={hiddenListRef} style={{
               position: 'absolute', top: '100%', right: '110px', // 버튼들 위치 고려
               width: '300px', background: 'white', border: '1px solid #ddd',
               boxShadow: '0 4px 12px rgba(0,0,0,0.15)', borderRadius: '8px', zIndex: 2000,
               marginTop: '5px', maxHeight: '300px', overflowY: 'auto'
             }}>
               {/* 팝업 헤더: 안내 문구 + 전체 복구 버튼 */}
               <div style={{ 
                 padding: '10px', borderBottom: '1px solid #eee', fontSize: '0.85rem', color: '#666', background: '#f8f9fa',
                 display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
               }}>
                 <span>클릭하면 캘린더에 복구됩니다.</span>
                 
                 {/* [추가됨] 전체 복구 버튼 */}
                 {hiddenTaskIds.length > 0 && (
                   <button 
                     onClick={() => setHiddenTaskIds([])}
                     style={{
                       border: 'none', background: 'transparent', color: '#0d6efd', 
                       cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem', padding: '2px 5px'
                     }}
                   >
                     전체 복구
                   </button>
                 )}
               </div>

               {hiddenTasksList.length === 0 ? (
                 <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '0.9rem' }}>숨겨진 과제가 없습니다.</div>
               ) : (
                 <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                   {hiddenTasksList.map((t, idx) => (
                     <li key={idx} onClick={() => handleRestore(t.id)}
                         style={{ padding: '10px', borderBottom: '1px solid #f1f3f5', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                         onMouseEnter={e => e.currentTarget.style.background = '#f1f3f5'}
                         onMouseLeave={e => e.currentTarget.style.background = 'white'}
                     >
                       <span style={{ fontSize: '0.9rem', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>{t.name}</span>
                       <span style={{ fontSize: '0.8rem', color: '#28a745', fontWeight: 'bold' }}>복구</span>
                     </li>
                   ))}
                 </ul>
               )}
             </div>
           )}
          </div>
        </div>

        {/* 4. 캘린더 그리드 */}
        <div className="calendar-grid"> 
          {/* 요일 헤더 */}
          {['일', '월', '화', '수', '목', '금', '토'].map(day => <div key={day} className="calendar-day-header">{day}</div>)} 
          
          {/* 날짜 셀 렌더링 */}
          {calendarData.daysInGrid.map((day, index) => { 
            const dayKey = day.toISOString().split('T')[0]; 
            const isCurrentMonth = day.getMonth() === calendarData.currentMonth; 
            const isToday = dayKey === todayKey; 
            const laneTasks = calendarData.tasksByDay.get(dayKey) || []; 
            
            // 리스트 제한 로직
            const MAX_VISIBLE = viewMode === 'all' ? 99 : 4; 
            const visibleLanes = laneTasks.slice(0, MAX_VISIBLE);
            const hiddenCount = laneTasks.slice(MAX_VISIBLE).filter(t => t && !hiddenTaskIds.includes(t.id)).length;

            // 상세 목록(드릴다운)에는 실제 보여지는 task들을 전달
            const dayTaskList = laneTasks.filter((t): t is Task => !!t).filter(t => !hiddenTaskIds.includes(t.id));
            
            return (
              <div key={index} className={`calendar-day ${isCurrentMonth ? '' : 'is-other-month'} ${isToday ? 'is-today' : ''}`}> 
                <div className="day-number" title="클릭하여 상세 목록 이동" onClick={(e) => handleGoToList(e, dayTaskList)} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#ccc', display: 'inline-block' }}>{day.getDate()}</div> 
                <div className="day-tasks"> 
                  {visibleLanes.map((task, laneIdx) => {
                    // lane 공백(종료 후/숨김 후)도 높이 유지
                    if (!task || hiddenTaskIds.includes(task.id)) {
                      return (
                        <div
                          key={`lane_${laneIdx}`}
                          className="calendar-task"
                          style={{ visibility: 'hidden', marginBottom: '2px' }}
                        >
                          placeholder
                        </div>
                      );
                    }

                    const isActive = task.isActive !== false;
                    return (
                      <div 
                        key={task.id} 
                        className={`calendar-task status-${task.status}`} 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setHiddenTaskIds(prev => [...prev, task.id]); 
                        }} 
                        title={`${task.name} (${task.assigneeName}) - 클릭하여 숨기기`}
                        style={{ 
                          opacity: isActive ? 1 : 0.4,
                          filter: isActive ? 'none' : 'grayscale(100%)',
                          border: isActive ? 'none' : '1px dashed #adb5bd',
                          marginBottom: '2px'
                        }}
                      >
                        <span className="calendar-task-assignee">{task.assigneeName}</span> {task.name}
                      </div>
                    );
                  })} 
                  {hiddenCount > 0 && (
                    <div className="more-tasks-indicator" onClick={(e) => { e.stopPropagation(); handleGoToList(e, dayTaskList); }}>
                      Task 목록
                    </div>
                  )}
                </div> 
              </div>
            ); 
          })} 
        </div> 
      </div> 
    </>
  );
};

  // UI 상태 자동 저장 (useEffect)
  useEffect(() => {
    const uiState: UIState = {
      currentMainView,
      currentView,
      filters,
      filterStartMonth,
      filterEndMonth,
      statusFilter,
      sortConfig,
      showInactive,
      excludeCompleted,
      taskSearchQuery,
      taskTableColumnWidths,
      calendarDate: calendarDate.toISOString(),
      isSidebarCollapsed
    };
    saveUIStateToLocal(uiState);
  }, [
    currentMainView,
    currentView,
    filters,
    filterStartMonth,
    filterEndMonth,
    statusFilter,
    sortConfig,
    showInactive,
    excludeCompleted,
    taskSearchQuery,
    taskTableColumnWidths,
    calendarDate,
    isSidebarCollapsed
  ]);

  if (!currentUser) {
    return (
      <>
        <GlobalStyles />
        <LoginView onLogin={handleUserLogin} organization={data.organization} />
      </>
    );
  }

  return (
    <>
      <GlobalStyles />
      <div className="notification-container">{notifications.map(n => <div key={n.id} className={`notification notification-${n.type}`}>{n.type === 'success' ? '✅' : '❌'} {n.message}</div>)}</div>
      {/* TaskList 상단 컨트롤바로 버튼 묶음을 이동 (기존 absolute 배치 제거됨) */}
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <div className="sticky-header-container">
            <header className="header">
              {isSidebarCollapsed && window.innerWidth <= 768 && (<button className="mobile-menu-btn" onClick={() => setIsSidebarCollapsed(false)} style={{ marginRight: '10px' }}>☰</button>)}
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <img 
                  src={LOGO_IMG} 
                  alt="S-Core Flow" 
                  style={{ height: '32px', objectFit: 'contain', cursor: 'pointer' }} 
                  onClick={() => {
                    // 권한에 맞게 대시보드로 이동
                    if (currentUser?.role === 'admin') {
                      setCurrentMainView('dashboard');
                      setCurrentView('department');
                    } else if (currentUser?.role === 'dept_head') {
                      setCurrentMainView('dashboard');
                      setCurrentView('department');
                    } else if (currentUser?.role === 'team_leader') {
                      setCurrentMainView('dashboard');
                      setCurrentView('team');
                    } else if (currentUser?.role === 'group_leader') {
                      setCurrentMainView('dashboard');
                      setCurrentView('group');
                    } else {
                      setCurrentMainView('dashboard');
                      setCurrentView('member');
                    }
                  }}
                />
                <span style={{ width: '1px', height: '16px', background: '#ccc', display: window.innerWidth <= 768 ? 'none' : 'block' }}></span>
                <span style={{ fontSize: '0.95rem', color: '#555', fontWeight: 500 }}> ENG혁신실 업무 현황 모니터링 </span>
              </div>
              {/* ✅ 우측: 접속자/로그아웃 + (기존 빨간박스 왼쪽 버튼들) 을 한 줄로 정렬 */}
              <div style={{display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto'}}>
                <div style={{display: 'flex', flexDirection: 'column', textAlign: 'right'}}>
                  <span style={{fontSize:'0.9rem', fontWeight:'bold', color: '#333'}}>{currentUser.name} {currentUser.position}</span>
                  <span style={{fontSize:'0.8rem', color:'#666'}}>{currentUser.role === 'admin' ? '관리자' : currentUser.role === 'dept_head' ? '실장' : currentUser.role === 'team_leader' ? '팀장' : currentUser.role === 'group_leader' ? '그룹장' : '팀원'}</span>
                </div>
                <button onClick={() => setLogoutConfirmOpen(true)} className="btn btn-secondary btn-sm" style={{ backgroundColor: 'white', color: '#495057', border: '1px solid #ced4da', padding: '6px 12px', fontSize: '0.85rem' }} title="로그아웃" > 로그아웃 </button>
                {currentUser.role === 'admin' && (
                  <>
                    <button className="btn btn-secondary header-action-btn" onClick={downloadTemplate}>
                      <span className="btn-icon">📋</span>
                      <span className="btn-text">표준양식 다운로드</span>
                    </button>
                    <label className="btn btn-success header-action-btn" style={{ cursor: 'pointer', margin: 0 }} title="통합 업로드 후 자동으로 내용이 저장됩니다.">
                      <span className="btn-icon">📤</span>
                      <span className="btn-text">통합 업로드</span>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleIntegratedUpload}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </>
                )}
              </div>
            </header>
            {currentMainView !== 'admin' && (!(currentMainView === 'taskList' && drillDownIds) && <ViewControls />)}
          </div>
          <div className="container" style={{ paddingTop: '20px' }}>
            {currentMainView === 'dashboard' && <DashboardView />}
            {currentMainView === 'taskList' && <TaskListView />}
            {currentMainView === 'calendar' && (<CalendarView tasks={filteredTasks} currentDate={calendarDate} setCurrentDate={setCalendarDate} onTaskClick={handleOpenDetailModal} onDrillDown={handleDrillDown} />)}
            {currentMainView === 'admin' && <AdminPanel data={data} onUpdateData={handleUpdateData} addNotification={addNotification} />}
          </div>
        </main>
      </div>

      {/* App 컴포넌트 하단 렌더링 부분 */}
      {isDetailModalOpen && (
        <TaskDetailModal 
          task={selectedTaskForDetail} 
          onClose={() => { setDetailModalOpen(false); setSelectedTaskForDetail(null); }} 
          currentUser={currentUser}
        />
      )}
      <UploadModal isOpen={isUploadModalOpen} onClose={() => setUploadModalOpen(false)} type={uploadType} onUpload={handleUpload} />
      <EditModal
        isOpen={isEditModalOpen}
        onClose={() => setEditModalOpen(false)}
        task={selectedTaskForEdit}
        onSave={handleSaveTask}
        onOpenRevisionModal={(task) => { setSelectedTaskForRevision(task); setRevisionModalOpen(true); }}
        onUpdateCategoryMaster={handleUpdateCategoryMaster}
        onNotification={addNotification}
        currentUser={currentUser}
      />
      <IssueModal isOpen={isIssueModalOpen} onClose={() => setIssueModalOpen(false)} task={selectedTaskForIssues} onUpdate={handleUpdateIssues} user={currentUser} organization={data.organization} />
      <RevisionModal isOpen={isRevisionModalOpen} onClose={() => setRevisionModalOpen(false)} task={selectedTaskForRevision} />
      <DailyPerformanceModal
        isOpen={isDailyModalOpen}
        onClose={() => setDailyModalOpen(false)}
        tasks={sortedAndFilteredTasks}
        onSave={(savedData) => {
          const { date, data: inputData } = savedData;
          setData(prevData => {
            const updatedTasks = prevData.tasks.map(task => {
              if (inputData[task.id] !== undefined || (task.dailyLogs && task.dailyLogs[date])) {
                const newDailyLogs = { ...(task.dailyLogs || {}) };
                const inputValue = inputData[task.id];
                if (inputValue) {
                  // hh.mm 형식 문자열로 저장 (mm이 60 초과 시 자동 변환)
                  const normalized = normalizeHHMM(inputValue);
                  if (normalized !== '00.00') {
                    newDailyLogs[date] = normalized;
                  } else {
                    delete newDailyLogs[date];
                  }
                } else {
                  delete newDailyLogs[date];
                }
                // 총 실적 시수 계산 (hh.mm 형식 문자열들을 숫자로 변환하여 합산)
                const dailyLogsValues: string[] = Object.values(newDailyLogs) as string[];
                const totalActual = dailyLogsValues.reduce((sum: number, h: string) => {
                  return sum + hhmmToNumber(h || '00.00');
                }, 0);
                const dates = Object.keys(newDailyLogs).sort();
                const newStartDate = dates.length > 0 ? dates[0] : null;
                const newEndDate = dates.length > 0 ? dates[dates.length - 1] : null;
                let newStatus = task.status;
                if (task.status === 'not-started' && totalActual > 0) newStatus = 'in-progress';
                return { ...task, status: newStatus, dailyLogs: newDailyLogs, actual: { ...task.actual, hours: normalizeHHMM(numberToHHMM(totalActual)), startDate: newStartDate || task.actual.startDate, endDate: newEndDate || task.actual.endDate } };
              }
              return task;
            });
            return { ...prevData, tasks: updatedTasks };
          });
          addNotification('일일 실적이 저장되었습니다.', 'success');
        }}
      />
      <TaskRegistrationModal
        isOpen={isTaskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onSubmit={handleAddTask}
        organization={data.organization}
        existingTasks={data.tasks}
        onError={(errors) => {
          setIntegratedUploadStatusLines([]);
          setIntegratedUploadErrorReasons([]);
          setUploadErrors(errors);
          setErrorModalTitle('Task 등록 오류');
          setIsErrorModalOpen(true);
        }}
        currentUser={currentUser}
        onNotification={addNotification}
        onUpdateCategoryMaster={handleUpdateCategoryMaster}
      />

      {/* 로그아웃 확인용 인라인 모달 구현 (삭제 -> 예 로 변경) */}
      {isLogoutConfirmOpen && (
        <div className="modal show" onClick={(e) => e.target === e.currentTarget && setLogoutConfirmOpen(false)} style={{ zIndex: 10000 }}>
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <h3 className="modal-header">확인</h3>
            <div className="modal-body">
              <p style={{ whiteSpace: 'pre-line', fontSize: '1rem', color: '#333' }}>정말로 로그아웃 하시겠습니까?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setLogoutConfirmOpen(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleLogoutConfirm}>예</button>
            </div>
          </div>
        </div>
      )}

      {/* 에러 모달 */}
      <ErrorModal
        isOpen={isErrorModalOpen}
        title={errorModalTitle}
        errors={uploadErrors}
        statusLines={integratedUploadStatusLines}
        errorReasons={integratedUploadErrorReasons}
        onClose={() => {
          setIsErrorModalOpen(false);
          setUploadErrors([]);
          setIntegratedUploadStatusLines([]);
          setIntegratedUploadErrorReasons([]);
        }}
      />
    </>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);