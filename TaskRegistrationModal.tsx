// --- Task Registration Modal Component ---

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { 
  Task, 
  Organization, 
  CategoryMaster, 
  UserContextType,
  NewTaskFormData 
} from './types';
import { categoryMasterData, categoryCodeMapping, orgCodeMapping } from './data';
import { calculateWorkingDays, getTodayStr, numberToHHMM, hhmmToNumber, validateHHMM, normalizeHHMM, normalizeFlexibleHHMMInput } from './utils';
import { generateTaskCodeForTask2 } from './taskCode';

interface TaskRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (task: Task) => void;
  organization: Organization;
  existingTasks: Task[];
  currentUser: UserContextType;
  onNotification: (message: string, type: 'success' | 'error') => void;
  onUpdateCategoryMaster?: (category1: string, category2: string, category3: string) => void;
  onError?: (errors: string[]) => void;
}

// 멤버 정보 조회 헬퍼
const getMemberInfo = (memberId: string, organization: Organization) => {
  for (const dept of organization.departments) {
    for (const team of dept.teams) {
      for (const group of team.groups) {
        const member = group.members.find(m => m.id === memberId);
        if (member) {
          return { 
            ...member, 
            group: group.name, 
            team: team.name, 
            department: dept.name, 
            teamId: team.id 
          };
        }
      }
    }
  }
  return null;
};

// 자동 Task 이름 생성
const generateAutoTaskName = (
  category1: string,
  category2: string,
  category3: string,
  existingTasks: Task[]
): string => {
  if (!category1 || !category2 || !category3) return '';
  
  const baseName = `${category1}_${category2}_${category3}`;
  const matchingTasks = existingTasks.filter(t => t.name.startsWith(baseName));
  
  if (matchingTasks.length === 0) return baseName;
  
  let maxNum = 0;
  matchingTasks.forEach(t => {
    if (t.name === baseName) {
      if (maxNum === 0) maxNum = 1;
    } else {
      const match = t.name.match(/#(\d+)$/);
      if (match) {
        const num = parseInt(match[1]);
        if (num > maxNum) maxNum = num;
      }
    }
  });
  
  return `${baseName} #${maxNum + 1}`;
};

export const TaskRegistrationModal: React.FC<TaskRegistrationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  organization,
  existingTasks,
  currentUser,
  onNotification,
  onUpdateCategoryMaster,
  onError
}) => {
  // 초기 폼 데이터 생성 함수
  const getInitialFormData = useCallback((): NewTaskFormData => {
    const defaultAssignee = (currentUser && currentUser.role === 'member') 
      ? currentUser.id 
      : 'emp01';
    
    return {
      category1: '',
      category2: '',
      category3: '',
      name: '',
      assignee: defaultAssignee,
      plannedStart: getTodayStr(),
      plannedEnd: getTodayStr(),
      plannedDailyHours: '08.00',
      plannedHours: '08.00',
      taskCode: ''
    };
  }, [currentUser]);

  const [formData, setFormData] = useState<NewTaskFormData>(getInitialFormData());
  const [showCategory3Dropdown, setShowCategory3Dropdown] = useState(false);
  const [category3Filter, setCategory3Filter] = useState('');

  // Admin의 업무 구분 마스터 데이터 (모든 팀에서 공통 사용)
  const adminCategoryMaster = useMemo(() => {
    const firstDept = organization.departments[0];
    if (firstDept && firstDept.teams.length > 0) {
      return firstDept.teams[0].categoryMaster || categoryMasterData;
    }
    return categoryMasterData;
  }, [organization]);

  // 모달이 열릴 때마다 폼 초기화
  useEffect(() => {
    if (isOpen) {
      setFormData(getInitialFormData());
    }
  }, [isOpen, getInitialFormData]);

  // Task 2 기반 Task Code 자동 생성 (Admin 마스터 기반 + 중복 없는 번호)
  useEffect(() => {
    if (!isOpen) return;

    const memberInfo = getMemberInfo(formData.assignee, organization);
    const shouldGenerate =
      !!formData.name.trim() &&
      !!formData.category1 &&
      !!formData.category2 &&
      !!formData.category3 &&
      !!memberInfo;

    if (!shouldGenerate) {
      // Clear only if user hasn't submitted anything yet; keep deterministic
      setFormData(prev => (prev.taskCode ? { ...prev, taskCode: '' } : prev));
      return;
    }

    const nextCode = generateTaskCodeForTask2({
      taskName: formData.name,
      category1: formData.category1,
      category2: formData.category2,
      category3: formData.category3,
      memberInfo: { department: memberInfo.department, team: memberInfo.team, group: memberInfo.group },
      adminCategoryMaster,
      existingTasks
    });

    setFormData(prev => (prev.taskCode === nextCode ? prev : { ...prev, taskCode: nextCode }));
  }, [
    isOpen,
    formData.name,
    formData.category1,
    formData.category2,
    formData.category3,
    formData.assignee,
    organization,
    adminCategoryMaster,
    existingTasks
  ]);

  // OBS 마스터 데이터 (담당자 팀 기준으로 필터링)
  const obsMaster = useMemo(() => {
    const memberInfo = getMemberInfo(formData.assignee, organization);
    if (!memberInfo) return {};
    
    const team = organization.departments[0]?.teams.find(t => t.id === memberInfo.teamId);
    return team ? (team.obsMaster || {}) : {};
  }, [formData.assignee, organization]);

  // 담당자의 팀 이름
  const assigneeTeamName = useMemo(() => {
    const memberInfo = getMemberInfo(formData.assignee, organization);
    return memberInfo ? memberInfo.team : '';
  }, [formData.assignee, organization]);
    
  // OBS 마스터에서 담당자 팀에 해당하는 업무 구분 Lv.3 목록 추출
  const obsAllowedCategory3 = useMemo(() => {
    const allowed = new Set<string>();
    
    // OBS 마스터의 모든 Lv.1을 순회
    Object.values(obsMaster).forEach((lv2Obj: any) => {
      // Lv.2가 담당자 팀과 일치하는 경우
      if (lv2Obj && typeof lv2Obj === 'object') {
        Object.keys(lv2Obj).forEach(teamName => {
          if (teamName === assigneeTeamName) {
            const lv3Array = lv2Obj[teamName];
            if (Array.isArray(lv3Array)) {
              lv3Array.forEach((lv3: string) => allowed.add(lv3));
            }
      }
    });
      }
    });
    
    return allowed;
  }, [obsMaster, assigneeTeamName]);

  // Lv.1 옵션 (OBS에 등록된 Task 1과 연결된 업무 구분 Lv.1만 표시)
  const category1Options = useMemo(() => {
    // OBS에 허용된 Lv.3가 없으면 업무구분 1도 표시하지 않음
    if (obsAllowedCategory3.size === 0) {
      return [];
    }
    
    // OBS에 등록된 Lv.3가 속한 Lv.1만 추출
    const allowedLv1 = new Set<string>();
    Object.keys(adminCategoryMaster).forEach(lv1Key => {
      // OBS 마스터 키(숫자로 시작하는 것)는 제외
      if (/^\d+\.\s/.test(lv1Key)) return;
      
      const lv2Obj = adminCategoryMaster[lv1Key] || {};
      // 해당 Lv.1 아래의 모든 Lv.2를 확인
      Object.values(lv2Obj).forEach((lv3Array: string[]) => {
        if (Array.isArray(lv3Array)) {
          // 해당 Lv.1의 Lv.3 중 하나라도 OBS에 허용된 것인지 확인
          if (lv3Array.some((lv3: string) => obsAllowedCategory3.has(lv3))) {
            allowedLv1.add(lv1Key);
          }
        }
      });
    });
    
    return Array.from(allowedLv1);
  }, [adminCategoryMaster, obsAllowedCategory3]);

  // Lv.2 옵션 (Admin의 업무 구분 Lv.2 중분류, OBS에 해당하는 것만 필터링)
  const category2Options = useMemo(() => {
    if (!formData.category1) return [];
    
    const lv2Obj = adminCategoryMaster[formData.category1] || {};
    const allLv2Keys = Object.keys(lv2Obj);
    
    // OBS 마스터에서 해당 Lv.2 아래에 담당자 팀이 있고, 그 팀의 Lv.3가 있는 경우만 필터링
    return allLv2Keys.filter(lv2Key => {
      const lv3List = lv2Obj[lv2Key] || [];
      // 해당 Lv.2의 Lv.3 중 하나라도 OBS에 허용된 것인지 확인
      return lv3List.some((lv3: string) => obsAllowedCategory3.has(lv3));
    });
  }, [formData.category1, adminCategoryMaster, obsAllowedCategory3]);

  // Lv.3 옵션 (Admin의 업무 구분 Lv.3 소분류, OBS에 해당하는 것만 필터링)
  const category3Options = useMemo(() => {
    if (!formData.category1 || !formData.category2) return [];
    
    const lv3List = adminCategoryMaster[formData.category1]?.[formData.category2] || [];
    // OBS에 허용된 Lv.3만 필터링
    return lv3List.filter((lv3: string) => obsAllowedCategory3.has(lv3));
  }, [formData.category1, formData.category2, adminCategoryMaster, obsAllowedCategory3]);

  // 선택된 업무구분 1, 2에 해당하는 Lv.3 소분류 목록 (Task 1 드롭다운용)
  const allCategory3Options = useMemo(() => {
    // 업무구분 1과 2가 선택되지 않았으면 빈 배열
    if (!formData.category1 || !formData.category2) {
      return [];
    }
    
    // 선택된 업무구분 1, 2에 해당하는 Lv.3 목록 가져오기
    const lv3List = adminCategoryMaster[formData.category1]?.[formData.category2] || [];
    
    // OBS에 허용된 항목만 필터링
    return lv3List.filter(lv3 => obsAllowedCategory3.has(lv3)).sort();
  }, [formData.category1, formData.category2, adminCategoryMaster, obsAllowedCategory3]);

  // 필터링된 Lv.3 옵션 (입력 텍스트 기반)
  const filteredCategory3Options = useMemo(() => {
    if (!category3Filter) return allCategory3Options;
    return allCategory3Options.filter(opt => 
      opt.toLowerCase().includes(category3Filter.toLowerCase())
    );
  }, [allCategory3Options, category3Filter]);

  // 폼 필드 변경 핸들러
  const handleFieldChange = useCallback((field: keyof NewTaskFormData, value: string) => {
    setFormData(prev => {
      let updated = { ...prev, [field]: value };

      // 카테고리 변경 시 자동 이름 생성
      if (['category1', 'category2', 'category3'].includes(field)) {
        if (updated.category1 && updated.category2 && updated.category3) {
          updated.name = generateAutoTaskName(
            updated.category1,
            updated.category2,
            updated.category3,
            existingTasks
          );
        }
      }

      // 하위 카테고리 초기화
      if (field === 'category1') {
        updated.category2 = '';
        updated.category3 = '';
      } else if (field === 'category2') {
        updated.category3 = '';
      }

      // 날짜 유효성 검사
      if (field === 'plannedStart' && updated.plannedEnd && updated.plannedEnd < value) {
        updated.plannedEnd = value;
      }
      
      if (field === 'plannedEnd' && updated.plannedStart && value < updated.plannedStart) {
        alert("종료일은 시작일보다 빠를 수 없습니다.");
        updated.plannedEnd = updated.plannedStart;
      }

      // 계획 시수 자동 계산 (hh.mm 형식)
      if (
        (field === 'plannedStart' || field === 'plannedEnd' || field === 'plannedDailyHours') &&
        updated.plannedStart &&
        updated.plannedEnd &&
        updated.plannedDailyHours &&
        validateHHMM(updated.plannedDailyHours)
      ) {
        const days = calculateWorkingDays(updated.plannedStart, updated.plannedEnd);
        const dailyHours = hhmmToNumber(updated.plannedDailyHours);
        const totalHours = days * dailyHours;
        updated.plannedHours = normalizeHHMM(numberToHHMM(totalHours));
      }

      return updated;
    });
  }, [existingTasks]);

  // 제출 핸들러
  const handleSubmit = useCallback(() => {
    const errors: string[] = [];

    // 유효성 검사
    if (!formData.name.trim()) {
      errors.push('Task명은 필수 입력 항목입니다.');
    }

    // 담당자 정보 조회
    const memberInfo = getMemberInfo(formData.assignee, organization);
    if (!memberInfo) {
      errors.push('담당자 정보를 찾을 수 없습니다.');
    }

    // OBS Lv.2/3 선택 여부 확인
    if (obsAllowedCategory3.size === 0) {
      errors.push('OBS Lv.2/3가 선택되지 않았습니다. 담당자의 팀에 OBS 배정이 필요합니다.');
    }

    // 카테고리 선택 여부 확인
    if (!formData.category1 || !formData.category2 || !formData.category3) {
      errors.push('업무 구분 1, 2, Task 1은 필수 선택 항목입니다.');
    }

    // 날짜 유효성 검사
    if (!formData.plannedStart) {
      errors.push('계획 착수일은 필수 입력 항목입니다.');
    }
    if (!formData.plannedEnd) {
      errors.push('계획 종료일은 필수 입력 항목입니다.');
    }
    if (formData.plannedStart && formData.plannedEnd && formData.plannedEnd < formData.plannedStart) {
      errors.push('계획 종료일은 계획 착수일보다 빠를 수 없습니다.');
    }

    // 시수 유효성 검사
    if (formData.plannedDailyHours && !validateHHMM(formData.plannedDailyHours)) {
      errors.push(`하루 예상 시수 형식이 올바르지 않습니다. (예: 08.00)`);
    }
    if (formData.plannedHours && !validateHHMM(formData.plannedHours)) {
      errors.push(`계획 시수 형식이 올바르지 않습니다. (예: 08.00)`);
    }

    // Task Code는 Task 2 기반으로 자동 생성되며(마스터 기반), 수동 입력을 받지 않습니다.

    // 에러가 있으면 에러 모달 표시
    if (errors.length > 0) {
      if (onError) {
        onError(errors);
      } else {
        alert(errors.join('\n'));
      }
      return;
    }

    // Lv.3 신규 항목이 마스터에 없으면 추가
    if (formData.category1 && formData.category2 && formData.category3) {
      const cat1Data = adminCategoryMaster[formData.category1] || {};
      const cat3List = cat1Data[formData.category2] || [];
      
      // 마스터에 없는 신규 항목인 경우
      if (!cat3List.includes(formData.category3)) {
        if (onUpdateCategoryMaster) {
          onUpdateCategoryMaster(formData.category1, formData.category2, formData.category3);
          onNotification(`신규 업무 구분 Lv.3 "${formData.category3}"가 마스터에 추가되었습니다.`, 'success');
        }
      }
    }

    // Task Code 결정: Task 2 기반 자동 생성(중복 없는 번호)
    const taskCode = generateTaskCodeForTask2({
      taskName: formData.name,
      category1: formData.category1,
      category2: formData.category2,
      category3: formData.category3,
      memberInfo: memberInfo ? { department: memberInfo.department, team: memberInfo.team, group: memberInfo.group } : null,
      adminCategoryMaster,
      existingTasks
    });

    // Task 객체 생성
    const newTask: Task = {
      id: `TASK-${Date.now()}`,
      taskCode,
      name: formData.name,
      category1: formData.category1 || '',
      category2: formData.category2 || '',
      category3: formData.category3 || '',
      department: memberInfo!.department || '미지정',
      team: memberInfo!.team,
      group: memberInfo!.group,
      assignee: formData.assignee,
      assigneeName: memberInfo!.name,
      planned: {
        startDate: formData.plannedStart || null,
        endDate: formData.plannedEnd || null,
        hours: validateHHMM(formData.plannedHours) ? normalizeHHMM(formData.plannedHours) : '00.00'
      },
      actual: { startDate: null, endDate: null, hours: '00.00' },
      revisions: [],
      status: 'not-started',
      monthlyIssues: [{
        date: getTodayStr(),
        issue: "신규 Task 등록 (수동)",
        reviewed: false,
        replies: []
      }],
      isActive: true
    };

    onSubmit(newTask);
    onNotification(`Task 등록 완료 (Code: ${taskCode})`, 'success');
    onClose();
  }, [formData, organization, adminCategoryMaster, existingTasks, obsAllowedCategory3, onSubmit, onNotification, onClose, onUpdateCategoryMaster, onError]);

  if (!isOpen) return null;

  // 스타일 정의
  const inputStyle = { backgroundColor: 'white', color: '#333', borderColor: '#ced4da' };
  const disabledStyle = { backgroundColor: '#e9ecef', color: '#6c757d', borderColor: '#ced4da' };

  // 멤버 정보 (옵션 렌더링용)
  const memberInfo = getMemberInfo(formData.assignee, organization);

  return (
    <div 
      className="modal show" 
    >
      <div className="modal-content">
        <h3 className="modal-header">Task 등록</h3>
        
        {/* 담당자 선택 */}
        {currentUser?.role !== 'member' && (
          <div className="form-group">
            <label className="form-label">담당자</label>
            <select
              className="form-input"
              value={formData.assignee}
              onChange={(e) => handleFieldChange('assignee', e.target.value)}
              style={inputStyle}
            >
              {organization.departments[0]?.teams.flatMap(team => team.groups).map(group => (
                <optgroup key={group.id} label={group.name}>
                  {group.members.map(member => (
                    <option key={member.id} value={member.id}>
                      {`${member.name} (${member.position})`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        <div className="form-row">
          {/* Lv.1: 업무 구분 1 */}
          <div className="form-group">
            <label className="form-label">업무 구분 1</label>
            <select
              className="form-input"
              value={formData.category1}
              onChange={(e) => handleFieldChange('category1', e.target.value)}
              disabled={obsAllowedCategory3.size === 0}
              style={obsAllowedCategory3.size === 0 ? disabledStyle : inputStyle}
            >
              <option value="">
                {obsAllowedCategory3.size === 0
                  ? "OBS에 배정된 업무가 없습니다"
                  : "선택하세요"}
              </option>
              {category1Options.map(cat => (
                <option key={cat} value={cat}>
                  {cat} {(categoryCodeMapping.category1 as any)[cat] 
                    ? ` (${(categoryCodeMapping.category1 as any)[cat]})` 
                    : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Lv.2: 업무 구분 2 (OBS 권한 필터링) */}
          <div className="form-group">
            <label className="form-label">업무 구분 2</label>
            <select
              className="form-input"
              value={formData.category2}
              onChange={(e) => handleFieldChange('category2', e.target.value)}
              disabled={!formData.category1}
              style={!formData.category1 ? disabledStyle : inputStyle}
            >
              <option value="">
                {!formData.category1
                  ? "상위 항목을 선택하세요"
                    : category2Options.length === 0
                      ? "해당 유형에 배정된 업무 없음"
                      : "선택하세요"}
              </option>
              {category2Options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Lv.3: Task 1 (항상 입력 가능, 커스텀 드롭다운으로 모든 업무 구분 Lv.3 소분류 참조) */}
        <div className="form-row">
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">Task 1</label>
            <input
              type="text"
              className="form-input"
              value={formData.category3}
              onChange={(e) => {
                handleFieldChange('category3', e.target.value);
                setCategory3Filter(e.target.value);
                setShowCategory3Dropdown(true);
              }}
              onFocus={() => {
                if (formData.category2) {
                  setShowCategory3Dropdown(true);
                  setCategory3Filter(formData.category3);
                }
              }}
              onBlur={(e) => {
                // 드롭다운 클릭 시에는 닫히지 않도록 약간의 지연
                setTimeout(() => setShowCategory3Dropdown(false), 200);
              }}
              placeholder={formData.category2 ? "선택하거나 직접 입력" : "상위 항목 선택 필요"}
              disabled={!formData.category2}
              style={!formData.category2 ? disabledStyle : inputStyle}
            />
            {/* 커스텀 드롭다운 리스트 */}
            {showCategory3Dropdown && formData.category2 && filteredCategory3Options.length > 0 && (
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
                {filteredCategory3Options.map(opt => (
                  <div
                    key={opt}
                    className="dropdown-option"
                    style={{
                      padding: '0.5rem 0.75rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f0f0f0'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f8f9fa';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#fff';
                    }}
                    onClick={() => {
                      handleFieldChange('category3', opt);
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
          {/* Task 2 */}
        <div className="form-group">
            <label className="form-label">Task 2</label>
          <input
            type="text"
            className="form-input"
            value={formData.name}
            onChange={(e) => handleFieldChange('name', e.target.value)}
            placeholder="Task명을 입력하세요"
            style={inputStyle}
          />
          </div>
        </div>

        {/* Task Code 입력 필드 */}
        <div className="form-group">
          <label className="form-label">Task Code</label>
          <input
            type="text"
            className="form-input"
            value={formData.taskCode || ''}
            disabled
            placeholder="Task 2 기준으로 자동 생성됩니다"
            style={disabledStyle}
          />
          <small style={{ color: '#6c757d', fontSize: '0.85rem', marginTop: '4px', display: 'block' }}>
            Admin 마스터(조직/업무구분) 기반으로 생성되며, Task 2 기준으로 번호가 절대 중복되지 않게 자동 채번됩니다.
          </small>
        </div>

        {/* 계획 기간 */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">계획 착수일</label>
            <input
              type="date"
              className="form-input"
              value={formData.plannedStart}
              onChange={(e) => handleFieldChange('plannedStart', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div className="form-group">
            <label className="form-label">계획 종료일</label>
            <input
              type="date"
              className="form-input"
              value={formData.plannedEnd}
              min={formData.plannedStart}
              onChange={(e) => handleFieldChange('plannedEnd', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* 시수 정보 */}
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">하루 예상 시수</label>
            <input
              type="text"
              className="form-input"
              value={formData.plannedDailyHours}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  handleFieldChange('plannedDailyHours', '');
                  return;
                }
                const normalized = normalizeFlexibleHHMMInput(val);
                handleFieldChange('plannedDailyHours', normalized ?? val);
              }}
              onBlur={(e) => {
                const val = e.target.value;
                if (!val) return;
                const normalized = normalizeFlexibleHHMMInput(val);
                if (normalized) handleFieldChange('plannedDailyHours', normalized);
                else handleFieldChange('plannedDailyHours', '');
              }}
              placeholder="예) hh.mm"
              pattern="\d+(\.\d+)?"
              style={inputStyle}
            />
          </div>
          <div className="form-group">
            <label className="form-label">계획 시수</label>
            <input
              type="text"
              className="form-input"
              value={formData.plannedHours}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '') {
                  handleFieldChange('plannedHours', '');
                  return;
                }
                const normalized = normalizeFlexibleHHMMInput(val);
                handleFieldChange('plannedHours', normalized ?? val);
              }}
              onBlur={(e) => {
                const val = e.target.value;
                if (!val) return;
                const normalized = normalizeFlexibleHHMMInput(val);
                if (normalized) handleFieldChange('plannedHours', normalized);
                else handleFieldChange('plannedHours', '');
              }}
              placeholder="예) hh.mm"
              pattern="\d+(\.\d+)?"
              style={inputStyle}
            />
          </div>
        </div>

        {/* 버튼 */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            취소
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
};
