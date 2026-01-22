export interface Loads {
  welder: boolean;
  grinder: boolean;
  light: boolean;
  pump: boolean;
}

export interface InspectionRecord {
  id: string;
  status: 'Complete' | 'In Progress' | 'Pending';
  lastInspectionDate: string;
  loads: Loads;
  photoUrl: string | null;
  memo: string;
  position?: {
    x: number; // percentage (0-100)
    y: number; // percentage (0-100)
  };
}

export type InspectionStatus = InspectionRecord['status'];

export interface StatData {
  name: string;
  value: number;
  color: string;
}

export interface ReportHistory {
  id: string;
  reportId: string;
  boardId: string;
  generatedAt: string;
  status: InspectionRecord['status'];
  htmlContent: string;
}