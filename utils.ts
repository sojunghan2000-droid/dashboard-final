// --- Utility Functions ---

// 한국 공휴일 목록
export const koreanHolidays = new Set([
  '2024-01-01', '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12', '2024-03-01', 
  '2024-04-10', '2024-05-01', '2024-05-05', '2024-05-06', '2024-05-15', '2024-06-06', 
  '2024-08-15', '2024-09-16', '2024-09-17', '2024-10-03', '2024-10-09', '2024-12-25', 
  '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-01', '2025-05-01', 
  '2025-05-05', '2025-05-06', '2025-06-06', '2025-08-15', '2025-10-03', '2025-10-06', 
  '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25', '2026-01-01', '2026-02-16', 
  '2026-02-17', '2026-02-18', '2026-03-01', '2026-05-01', '2026-05-05', '2026-05-25', 
  '2026-06-06', '2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-03', 
  '2026-10-09', '2026-12-25'
]);

// 근무일 계산 함수
export const calculateWorkingDays = (startDateStr: string, endDateStr: string): number => {
  if (!startDateStr || !endDateStr) return 0;
  
  let currentDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  
  if (isNaN(currentDate.getTime()) || isNaN(endDate.getTime()) || currentDate > endDate) {
    return 0;
  }
  
  let workingDays = 0;
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    const dateString = currentDate.toISOString().split('T')[0];
    
    // 주말이 아니고 공휴일이 아닌 경우만 카운트
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !koreanHolidays.has(dateString)) {
      workingDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return workingDays;
};

// 오늘 날짜 문자열 반환 (KST 기준)
export const getTodayStr = (): string => {
  const today = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(today.getTime() + kstOffset).toISOString().split('T')[0];
};

// MH 관련 유틸리티 함수 (hh.mm 형식)
// 숫자(시간)를 hh.mm 형식 문자열로 변환
export const numberToHHMM = (hours: number): string => {
  if (isNaN(hours) || hours < 0) return '00.00';
  
  // 소수점 세 자리 이상 버림
  const truncated = Math.floor(hours * 100) / 100;
  
  const totalMinutes = Math.floor(truncated * 60);
  let h = Math.floor(totalMinutes / 60);
  let m = totalMinutes % 60;
  
  // 60분이면 1시간으로 올림
  if (m >= 60) {
    h += Math.floor(m / 60);
    m = m % 60;
  }
  
  return `${String(h).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
};

// hh.mm 형식 문자열을 숫자(시간)로 변환 (계산용)
export const hhmmToNumber = (hhmm: string): number => {
  if (!hhmm || typeof hhmm !== 'string') return 0;
  
  const parts = hhmm.trim().split('.');
  if (parts.length !== 2) return 0;
  
  const h = parseInt(parts[0], 10) || 0;
  let m = parseInt(parts[1], 10) || 0;
  
  // mm이 60 이상이면 시간으로 변환
  if (m >= 60) {
    const additionalHours = Math.floor(m / 60);
    m = m % 60;
    return h + additionalHours + (m / 60);
  }
  
  return h + (m / 60);
};

// hh.mm 형식 검증 (입력 중 허용, mm이 60 초과해도 허용 - normalizeHHMM에서 자동 변환)
export const validateHHMM = (hhmm: string, strict: boolean = false): boolean => {
  if (!hhmm || typeof hhmm !== 'string') return false;
  
  const parts = hhmm.trim().split('.');
  if (parts.length !== 2) return false;
  
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  
  if (isNaN(h) || isNaN(m)) return false;
  if (h < 0) return false;
  
  // strict 모드에서는 mm이 60 초과 불가, 일반 모드에서는 허용 (자동 변환됨)
  if (strict && (m < 0 || m > 60)) return false;
  if (m < 0) return false;
  
  return true;
};

// hh.mm 형식 정규화 (60mm를 1h로 변환, 소수점 세 자리 이상 버림)
export const normalizeHHMM = (hhmm: string): string => {
  if (!validateHHMM(hhmm)) return '00.00';
  
  const parts = hhmm.trim().split('.');
  let h = parseInt(parts[0], 10) || 0;
  let m = parseInt(parts[1], 10) || 0;
  
  // 60분이면 1시간으로 올림
  if (m >= 60) {
    h += Math.floor(m / 60);
    m = m % 60;
  }
  
  return `${String(h).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
};

// 유연한 hh.mm 입력 파서
// - 8 -> 8.00
// - 0.1 -> 0.10
// - 0.01 -> 0.01
// - 소수점 2자리 초과 입력은 "올림" 처리 (예: 0.001 -> 0.01, 1.009 -> 1.01)
// - mm은 0~60 범위만 허용
export const normalizeFlexibleHHMMInput = (raw: string): string | null => {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\d+\.?$/.test(s)) return null;
  const [hStr, frac = ''] = s.split('.');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h) || h < 0) return null;

  // "8" 또는 "8." 형태
  if (!s.includes('.') || frac.length === 0) return `${h}.00`;

  // 소수점 1자리: 10분 단위
  // 소수점 2자리: 그대로 분
  // 소수점 3자리 이상: 뒤에 남는 값이 있으면 올림(최소 0.01 보장)
  const head2 = frac.padEnd(2, '0').slice(0, 2);
  let m = parseInt(head2, 10);
  if (Number.isNaN(m)) return null;

  const rest = frac.slice(2);
  const shouldCeil = rest.length > 0 && /[1-9]/.test(rest);
  if (shouldCeil) m += 1;

  if (m < 0 || m > 60) return null;
  return `${h}.${String(m).padStart(2, '0')}`;
};