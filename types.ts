// --- Type Definitions ---

export type UserRole = 'admin' | 'team_leader' | 'group_leader' | 'member';

export type Reply = {
  id: string;
  text: string;
  timestamp: string; // YYYY-MM-DD HH:mm
  checked?: boolean; // 확인 여부
  author?: string; // 작성자 이름
};

export type Issue = { 
  date: string; // YYYY-MM-DD
  issue: string; 
  reviewed: boolean;
  replies?: Reply[]; 
  month?: string; 
};

export type Period = { 
  startDate: string | null; 
  endDate: string | null; 
  hours: string // hh.mm 형식 (예: "08.30" = 8시간 30분)
};

export type Revision = { 
  revisionDate: string; 
  reason: string; 
  period: Period 
};

export type TaskStatus = 'completed' | 'in-progress' | 'delayed' | 'not-started';

export type Task = {
  id: string;
  taskCode: string;
  category1: string;
  category2: string;
  category3: string;
  name: string;
  department: string;
  team: string;
  group: string;
  assignee: string;
  assigneeName: string;
  planned: Period;
  revisions: Revision[];
  actual: Period;
  monthlyIssues: Issue[];
  status: TaskStatus;
  isActive?: boolean; // [핵심] 숨김/활성 상태 관리 (undefined or true: 활성, false: 숨김)
  dailyLogs?: { [date: string]: string }; // hh.mm 형식 (예: "08.30" = 8시간 30분)
};

export type Member = { 
  id: string; 
  name: string; 
  position: string;
  loginId?: string;  
  password?: string; 
  role?: UserRole;   
};

export type UserContextType = Member & {
  departmentId?: string;
  teamId?: string;
  groupId?: string;
} | null;

export type Group = { 
  id: string; 
  name: string; 
  members: Member[] 
};

export type CategoryMaster = { 
  [key: string]: { 
    [key: string]: string[] 
  } 
};

export type Team = { 
  id: string; 
  name: string; 
  groups: Group[]; 
  categoryMaster: CategoryMaster;
  obsMaster?: CategoryMaster; // OBS 관리 데이터 (업무 구분과 분리)
};

export type Department = { 
  id: string; 
  name: string; 
  teams: Team[] 
};

export type Organization = { 
  departments: Department[] 
};

export type SampleData = { 
  organization: Organization; 
  tasks: Task[]; 
};

export type ViewType = 'department' | 'team' | 'group' | 'member';

// Sorting Types
export type SortKey = 'taskCode' | 'category' | 'name' | 'assigneeName' | 'affiliation' | 'planned' | 'actual' | 'status' | 'issues';

export type SortConfig = { 
  key: SortKey; 
  direction: 'asc' | 'desc' 
};

export type Notification = { 
  id: number; 
  message: string; 
  type: 'success' | 'error' 
};

// Upload Preview Types
export type UploadError = { 
  rowIndex: number; 
  messages: string[] 
};

export type UploadPreview = { 
  data: any[]; 
  errors: UploadError[] 
};

// Task Registration Modal Types
export type NewTaskFormData = {
  category1: string;
  category2: string;
  category3: string;
  name: string;
  assignee: string;
  plannedStart: string;
  plannedEnd: string;
  plannedDailyHours: string;
  plannedHours: string;
  taskCode?: string; // 선택적 Task Code 입력
};
