// --- Database Structure & Sample Data Generation ---

import type {
  Organization,
  Department,
  Team,
  Group,
  Member,
  Task,
  TaskStatus,
  CategoryMaster,
  SampleData,
  Issue,
  Revision,
  Period
} from './types';
import { numberToHHMM, normalizeHHMM } from './utils';

// --- Mappings & Master Data ---

// 업무 카테고리 코드 매핑 (Category Code Mapping)
export const categoryCodeMapping = {
  category1: {
    '기획': 'PL01',      // Planning
    '현장지원': 'FS01',  // Field Support
    '기술 개발': 'DV01', // Development
    '연구': 'RS01',      // Research
    '기타': 'OT01'       // Others
  }
};

// 조직 코드 매핑 (Organization Code Mapping)
export const orgCodeMapping = {
  departments: { 'ENG혁신실': 'DI' },
  teams: { 
    'AI개발팀': 'AI', 
    'TA팀': 'TA', 
    '융합기술팀': 'CT', 
    '기반기술팀': 'BT', 
    'ENG혁신지원그룹': 'ES'
  },
  groups: {
    '자연어처리그룹': 'NLP', 
    '컴퓨터비전그룹': 'CV', 
    '머신러닝플랫폼그룹': 'MLP', 
    'TA그룹': 'TAG',
    '융합S/W그룹': 'CSW', 
    '클라우드인프라그룹': 'CIG', 
    'ENG혁신지원그룹': 'PSG'
  }
};

// OBS 코드 매핑 (OBS Code Mapping)
export const obsCodeMapping = {
  lv1: {
    '1. 중점과제': 'O01',
    '2. 지시과제': 'O02',
    '3. 자체과제': 'O03',
    '4. 기타': 'O04'
  },
  // Lv.2는 팀 이름에 따라 동적으로 생성 (orgCodeMapping.teams 사용)
  // Lv.3는 업무 구분 Lv.3 코드 사용 (categoryCodeMapping 사용)
};

// 업무 카테고리 마스터 데이터 (Category Master Data)
export const categoryMasterData: CategoryMaster = {
  '기획 (PL01)': { 
    '전략기획': ['사업계획 수립', 'KPI 설정', '중장기 로드맵', '시장 동향 분석', '경쟁사 벤치마킹'],
    '프로젝트관리': ['WBS 작성', '일정/리소스 관리', '리스크 관리', '주간/월간 보고', '요구사항 정의'],
    '서비스기획': ['화면 설계(UI/UX)', '기능 명세서 작성', '사용자 시나리오', '정책 수립'],
  },
  '현장지원 (FS01)': { 
    '기술지원': ['VOC 분석 및 대응', '현장 트러블슈팅', '기술 자문', 'L1/L2 장애 지원'],
    '유지보수': ['정기 점검', '시스템 모니터링', '버그 패치', 'SW 버전 업데이트', '데이터 백업'],
    '교육지원': ['사용자 매뉴얼 작성', '운영자 교육', '기술 세미나 지원', 'FAQ 업데이트'],
  },
  '기술 개발 (DV01)': { 
    'AI모델개발': ['데이터 전처리', '모델 학습/튜닝', 'RAG 시스템 구축', '모델 성능 평가', '프롬프트 엔지니어링'],
    '플랫폼개발': ['프론트엔드 개발', '백엔드 API 구축', 'DB 스키마 설계', '인터페이스 연동', '레거시 마이그레이션'],
    '인프라구축': ['클라우드(AWS/GCP) 환경셋업', 'CI/CD 파이프라인', '보안 그룹 설정', '서버 리소스 최적화'],
    '품질확보': ['단위/통합 테스트', '코드 리뷰', '성능 부하 테스트', '보안 취약점 점검'],
  },
  '연구 (RS01)': { 
    '선행연구': ['최신 논문 리뷰', '신기술 PoC', '알고리즘 프로토타이핑', '기술 타당성 검토'],
    '지식재산': ['특허 출원', '직무 발명 신고', '특허 침해 분석', '라이선스 검토'],
    '데이터연구': ['학습용 데이터셋 구축', '데이터 품질 검증', '데이터 레이블링 가이드', '합성 데이터 생성'],
  },
  '기타 (OT01)': { 
    '행정업무': ['비용 품의/정산', '구매 요청', '근태 관리', '비품 관리', '계약 관리'],
    '사내활동': ['팀 빌딩', '전사 타운홀 미팅', '사내 교육 수강', '멘토링 활동', '채용 면접 지원'],
  }
};

// --- Data Generation Logic ---

const getRandomElement = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];
const getRandomDate = (start: Date, end: Date) => 
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));

// Task 생성 함수
export const generateAllTasks = (organization: Organization): Task[] => {
  const tasks: Task[] = [];
  const allMembersWithContext = organization.departments.flatMap(d => 
    d.teams.flatMap(t => 
      t.groups.flatMap(g => 
        g.members.map(m => ({ 
          ...m, 
          department: d.name, 
          team: t.name, 
          group: g.name, 
          categoryMaster: t.categoryMaster 
        }))
      )
    )
  );
  const taskCounters: { [key: string]: number } = {};

  for (const member of allMembersWithContext) {
    const numTasks = 48 + Math.floor(Math.random() * 5);
    const categoryMaster = member.categoryMaster;
    
    for (let i = 0; i < numTasks; i++) {
      const category1 = getRandomElement(Object.keys(categoryMaster));
      const cat2Keys = Object.keys(categoryMaster[category1]);
      const category2 = getRandomElement(cat2Keys);
      const cat3Keys = categoryMaster[category1][category2];
      const category3 = getRandomElement(cat3Keys);
      
      const deptCode = (orgCodeMapping.departments as any)[member.department] || 'DXX';
      const teamCode = (orgCodeMapping.teams as any)[member.team] || 'TXX';
      const groupCode = (orgCodeMapping.groups as any)[member.group] || 'GXX';
      const orgPrefix = `${deptCode}-${teamCode}-${groupCode}`;
      
      const cat1Code = (categoryCodeMapping.category1 as any)[category1] || 'X01';
      const cat2Index = cat2Keys.indexOf(category2) + 1 || 1;
      const cat3Index = cat3Keys.indexOf(category3) + 1 || 1;
      const counterKey = `${category1}-${category2}-${category3}`;
      taskCounters[counterKey] = (taskCounters[counterKey] || 0) + 1;
      const taskNum = taskCounters[counterKey];
      const categorySuffix = `${cat1Code}.${cat2Index}.${cat3Index}.${taskNum}`;
      const taskCode = `${orgPrefix}-${categorySuffix}`;
      
      const plannedStartDate = getRandomDate(new Date('2024-06-01'), new Date('2026-05-31'));
      const plannedDuration = 30 + Math.floor(Math.random() * 90);
      const plannedEndDate = new Date(plannedStartDate);
      plannedEndDate.setDate(plannedStartDate.getDate() + plannedDuration);
      const plannedHours = (plannedDuration * 4) + Math.floor(Math.random() * 40);
      
      let actualStartDate: Date | null = null;
      let actualEndDate: Date | null = null;
      let actualHours = 0;
      let status: TaskStatus;
      const taskStateChance = Math.random();
      const today = new Date();
      
      if (taskStateChance < 0.4 && plannedStartDate < today) {
        const actualStartOffset = Math.floor(Math.random() * 10);
        actualStartDate = new Date(plannedStartDate);
        actualStartDate.setDate(plannedStartDate.getDate() + actualStartOffset);
        const actualDuration = plannedDuration - 5 + Math.floor(Math.random() * 10);
        actualEndDate = new Date(actualStartDate);
        actualEndDate.setDate(actualStartDate.getDate() + actualDuration);
        if (actualEndDate > today) { 
          actualEndDate = null; 
          status = 'in-progress'; 
          actualHours = Math.floor(plannedHours * Math.random()); 
        } else { 
          status = 'completed'; 
          actualHours = plannedHours - 20 + Math.floor(Math.random() * 40); 
        }
      } else if (taskStateChance < 0.75 && plannedStartDate < today) {
        const actualStartOffset = Math.floor(Math.random() * 10);
        actualStartDate = new Date(plannedStartDate);
        actualStartDate.setDate(plannedStartDate.getDate() + actualStartOffset);
        actualHours = Math.floor(plannedHours * Math.random());
        status = plannedEndDate < today ? 'delayed' : 'in-progress';
      } else { 
        status = 'not-started'; 
      }
      
      const formatDate = (date: Date | null) => date ? date.toISOString().split('T')[0] : null;
      const monthlyIssues: Issue[] = [];
      
      if (Math.random() < 0.2) { 
        const randomMonth = `2025-${String(1 + Math.floor(Math.random() * 5)).padStart(2, '0')}`;
        monthlyIssues.push({ 
          date: `${randomMonth}-01`,
          month: randomMonth, 
          issue: `샘플 이슈: ${category3} 관련 처리 지연`, 
          reviewed: Math.random() < 0.5 
        }); 
      }
      
      const revisions: Revision[] = [];
      if (Math.random() < 0.15) {
        const revStartDate = new Date(plannedStartDate);
        const newEndDate = new Date(plannedEndDate);
        newEndDate.setDate(plannedEndDate.getDate() + 15);
        revisions.push({ 
          revisionDate: formatDate(new Date(revStartDate.setDate(revStartDate.getDate() + 10))), 
          reason: '요구사항 변경으로 인한 계획 수정', 
          period: { 
            startDate: formatDate(plannedStartDate), 
            endDate: formatDate(newEndDate), 
            hours: normalizeHHMM(numberToHHMM(plannedHours + 40))
          } 
        });
      }
      
      tasks.push({ 
        id: `l4_${member.id}_${i}`, 
        taskCode, 
        category1, 
        category2, 
        category3, 
        name: `${member.group} ${category3} 과제 #${i + 1}`, 
        department: member.department, 
        team: member.team, 
        group: member.group, 
        assignee: member.id, 
        assigneeName: member.name, 
        planned: { 
          startDate: formatDate(plannedStartDate), 
          endDate: formatDate(plannedEndDate), 
          hours: normalizeHHMM(numberToHHMM(plannedHours))
        }, 
        revisions, 
        actual: { 
          startDate: formatDate(actualStartDate), 
          endDate: formatDate(actualEndDate), 
          hours: normalizeHHMM(numberToHHMM(Math.max(0, actualHours)))
        }, 
        monthlyIssues, 
        status, 
        isActive: Math.random() < 0.95 
      });
    }
  }
  return tasks;
};

// OBS 마스터 초기 데이터 생성 함수
const createInitialOBSMaster = (teamName: string): CategoryMaster => {
  const FIXED_LV1_OPTIONS = ["1. 중점과제", "2. 지시과제", "3. 자체과제", "4. 기타"];
  const obsMaster: CategoryMaster = {};
  
  // 고정 Lv.1 옵션 초기화
  FIXED_LV1_OPTIONS.forEach(lv1 => {
    obsMaster[lv1] = {};
    // 각 팀에 대해 기본적으로 "3. 자체과제"에 업무 구분 Lv.3 일부 항목 추가
    if (lv1 === "3. 자체과제") {
      // 업무 구분 마스터에서 Lv.3 소분류 추출하여 초기 데이터로 사용
      const initialLv3Items: string[] = [];
      Object.values(categoryMasterData).forEach(lv2Obj => {
        Object.values(lv2Obj).forEach((lv3Array: string[]) => {
          if (Array.isArray(lv3Array)) {
            lv3Array.forEach(lv3 => {
              if (!initialLv3Items.includes(lv3)) {
                initialLv3Items.push(lv3);
              }
            });
          }
        });
      });
      // 팀별로 초기 OBS 마스터 데이터 설정
      obsMaster[lv1][teamName] = initialLv3Items.slice(0, 10).sort(); // 처음 10개만 선택
    }
  });
  
  return obsMaster;
};

// 조직 데이터 초기화 및 카테고리 매핑
const initialOrganizationData: Organization = { 
  departments: [{ 
    id: 'dept1', 
    name: 'ENG혁신실', 
    teams: [
      { 
        id: 'team1', 
        name: 'AI개발팀', 
        groups: [
          { 
            id: 'group1', 
            name: '자연어처리그룹', 
            members: [
              { id: 'emp01', name: '김철수', position: '선임연구원' }, 
              { id: 'emp02', name: '이영희', position: '주임연구원' }
            ] 
          }, 
          { 
            id: 'group2', 
            name: '컴퓨터비전그룹', 
            members: [{ id: 'emp09', name: '임서준', position: '선임연구원' }] 
          }
        ], 
        categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)),
        obsMaster: createInitialOBSMaster('AI개발팀')
      }, 
      { 
        id: 'team2', 
        name: 'TA팀', 
        groups: [{ 
          id: 'group_ta1', 
          name: 'TA그룹', 
          members: [{ id: 'emp25', name: '정태영', position: '책임연구원' }] 
        }], 
        categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)),
        obsMaster: createInitialOBSMaster('TA팀')
      }, 
      { 
        id: 'team3', 
        name: '융합기술팀', 
        groups: [{ 
          id: 'group_ct1', 
          name: '융합S/W그룹', 
          members: [{ id: 'emp28', name: '박지수', position: '수석연구원' }] 
        }], 
        categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)),
        obsMaster: createInitialOBSMaster('융합기술팀')
      }, 
      { 
        id: 'team4', 
        name: '기반기술팀', 
        groups: [{ 
          id: 'group_bt1', 
          name: '클라우드인프라그룹', 
          members: [{ id: 'emp30', name: '김하은', position: '책임연구원' }] 
        }], 
        categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)),
        obsMaster: createInitialOBSMaster('기반기술팀')
      }, 
      { 
        id: 'team5', 
        name: 'ENG혁신지원그룹', 
        groups: [{ 
          id: 'group_es1', 
          name: 'ENG혁신지원그룹', 
          members: [
            { id: 'emp33', name: '이승우', position: '프로' }, 
            { id: 'emp34', name: '김재석', position: '선임프로' }, 
            { id: 'emp35', name: '장경욱', position: '프로' },
            { id: 'a', name: '소중한', position: '프로' }
          ] 
        }], 
        categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)),
        obsMaster: createInitialOBSMaster('ENG혁신지원그룹')
      }
    ] 
  }] 
};

// 초기 데이터 전체에 기본 계정 정보 주입하는 함수
const hydrateMembersWithAuth = (org: Organization): Organization => { 
  const newOrg = JSON.parse(JSON.stringify(org)); 
  newOrg.departments.forEach((d: Department) => { 
    d.teams.forEach((t: Team) => { 
      t.groups.forEach((g: Group) => { 
        g.members.forEach((m: Member) => { 
          if (!m.loginId) m.loginId = m.id; 
          if (m.name === '장경욱') { 
            m.loginId = 'emp35'; 
            m.password = '1234'; 
            m.role = 'group_leader'; 
          } else { 
            if (!m.password) m.password = '1234'; 
            if (!m.role) { 
              if (m.position.includes('팀장') || m.position.includes('수석')) m.role = 'team_leader'; 
              else if (m.position.includes('파트장') || m.position.includes('책임')) m.role = 'group_leader'; 
              else m.role = 'member'; 
            } 
          } 
        }); 
      }); 
    }); 
  }); 
  return newOrg; 
};

// Auth Data Hydration
const hydratedOrg = hydrateMembersWithAuth(initialOrganizationData);
export const organizationData: Organization = { 
  ...hydratedOrg, 
  departments: hydratedOrg.departments.map((dept: Department) => ({ 
    ...dept, 
    teams: dept.teams.map((team: Team) => ({ 
      ...team, 
      categoryMaster: JSON.parse(JSON.stringify(categoryMasterData)),
      obsMaster: team.obsMaster || createInitialOBSMaster(team.name)
    })) 
  })) 
};

// 샘플 데이터 생성
export const sampleData: SampleData = { 
  organization: organizationData, 
  tasks: generateAllTasks(organizationData), 
};
