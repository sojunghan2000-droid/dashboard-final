export interface Loads {
  welder: boolean;
  grinder: boolean;
  light: boolean;
  pump: boolean;
}

export interface BreakerInfo {
  breakerNo: string; // 차단기 No.
  category: '1차' | '2차'; // 구분
  breakerCapacity: number; // 차단기 용량[A]
  loadName: string; // 부하명 (고정부하, 이동부하X)
  type: string; // 형식
  kind: 'MCCB' | 'ELB'; // 종류
  currentL1: number; // 전류 (A) L1
  currentL2: number; // 전류 (A) L2
  currentL3: number; // 전류 (A) L3
  loadCapacityR: number; // 부하 용량[W] R
  loadCapacityS: number; // 부하 용량[W] S
  loadCapacityT: number; // 부하 용량[W] T
  loadCapacityN: number; // 부하 용량[W] N
}

export interface ThermalImageData {
  imageUrl: string | null; // 열화상 이미지 URL
  temperature: number; // 온도 측정값
  maxTemp: number; // 최대 온도
  minTemp: number; // 최소 온도
  emissivity: number; // 방사율
  measurementTime: string; // 측정 시간
  equipment: string; // 측정기 (예: KT-352)
}

export interface LoadSummary {
  phaseLoadSumA: number; // 상별 부하 합계 [AV] A
  phaseLoadSumB: number; // 상별 부하 합계 [AV] B
  phaseLoadSumC: number; // 상별 부하 합계 [AV] C
  totalLoadSum: number; // 총 연결 부하 합계[AV]
  phaseLoadShareA: number; // 상별 부하 분담 [%] A
  phaseLoadShareB: number; // 상별 부하 분담 [%] B
  phaseLoadShareC: number; // 상별 부하 분담 [%] C
}

export interface InspectionRecord {
  panelNo: string; // PNL NO. (유일 식별자)
  status: 'Complete' | 'In Progress' | 'Pending';
  lastInspectionDate: string;
  loads: Loads;
  photoUrl: string | null;
  memo: string;
  position?: {
    x: number; // percentage (0-100)
    y: number; // percentage (0-100)
  };
  // 사진의 엑셀 보고서 구조 반영
  inspectors?: string[]; // 점검자 (예: ["이재두 프로", "김윤수 프로", "이승환 프로"])
  projectName?: string; // PJT명
  contractor?: string; // 시공사
  managementNumber?: string; // 관리번호 (판넬명)
  breakers?: BreakerInfo[]; // 차단기 정보 배열
  grounding?: '양호' | '불량' | '미점검'; // 접지 (외관 점검)
  thermalImage?: ThermalImageData; // 열화상 측정 데이터
  loadSummary?: LoadSummary; // 부하 합계 정보
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

export interface QRCodeData {
  id: string;
  location: string;
  floor: string;
  position: string;
  qrData: string; // JSON string
  createdAt: string;
}