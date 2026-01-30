import { InspectionRecord, ReportHistory } from '../types';
import * as XLSX from 'xlsx';

const STORAGE_KEY = 'safetyguard_reports';

// Create report object (no storage)
export const createReportFromRecord = (record: InspectionRecord, htmlContent: string): ReportHistory => ({
  id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  reportId: `RPT-${record.panelNo}-${new Date().toISOString().split('T')[0]}`,
  boardId: record.panelNo,
  generatedAt: new Date().toISOString(),
  status: record.status,
  htmlContent: htmlContent
});

// Save report to localStorage (legacy; use onReportSaved for in-memory)
const saveReportToStorage = (report: ReportHistory): void => {
  const reports: ReportHistory[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  reports.unshift(report);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
};

// ID에서 "1st"를 "F1"으로 변경하는 함수
const migrateIdFloor = (id: string): string => {
  if (id && typeof id === 'string') {
    if (id.includes('-1st-')) {
      return id.replace(/-1st-/g, '-F1-');
    }
    if (id.startsWith('DB-1st-')) {
      return id.replace(/^DB-1st-/, 'DB-F1-');
    }
  }
  return id;
};

// Reports 데이터 마이그레이션
const migrateReports = (reports: ReportHistory[]): ReportHistory[] => {
  return reports.map(report => {
    const migrated: ReportHistory = { ...report };
    
    if (migrated.boardId) {
      migrated.boardId = migrateIdFloor(migrated.boardId);
    }
    
    if (migrated.reportId && migrated.reportId.includes('1st')) {
      migrated.reportId = migrateIdFloor(migrated.reportId);
    }
    
    if (migrated.htmlContent && migrated.htmlContent.includes('1st')) {
      migrated.htmlContent = migrated.htmlContent.replace(/DB-1st-/g, 'DB-F1-');
    }
    
    return migrated;
  });
};

// Get all saved reports
export const getSavedReports = (): ReportHistory[] => {
  const reports = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const migrated = migrateReports(reports);
  
  if (JSON.stringify(reports) !== JSON.stringify(migrated)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch (e) {
      console.error('Failed to save migrated reports to localStorage:', e);
    }
  }
  
  return migrated;
};

// Get report by ID
export const getReportById = (id: string): ReportHistory | null => {
  const reports = getSavedReports();
  return reports.find(r => r.id === id) || null;
};

// Delete report (in-memory: pass options; otherwise localStorage)
export const deleteReport = (
  id: string,
  options?: { reports: ReportHistory[]; setReports: (reports: ReportHistory[]) => void }
): void => {
  if (options) {
    const filtered = options.reports.filter(r => r.id !== id);
    options.setReports(filtered);
    return;
  }
  const reports = getSavedReports();
  const filtered = reports.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

// Excel 파일 생성 함수
export const generateExcelReport = (record: InspectionRecord): void => {
  const wb = XLSX.utils.book_new();

  // 기본 정보 행
  const basicInfoRows: any[][] = [
    ['공사용 가설 분전반', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '가설 전기 점검'],
    [],
    ['PNL NO.', record.panelNo, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['PJT명', record.projectName || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['시공사', record.contractor || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['관리번호 (판넬명)', record.managementNumber || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['점검자', (record.inspectors || []).join(', ') || '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    [],
  ];

  // 차단기 정보 헤더
  const breakerHeader = [
    '차단기 No.',
    '구분 (1차, 2차)',
    '차단기 용량[A]',
    '부하명 (고정부하, 이동부하X)',
    '형식',
    '종류 (MCCB, ELB)',
    '전류 (A) (후크메가)',
    '',
    '',
    '',
    '부하 용량[W]',
    '',
    '',
    '',
    '접지 (외관 점검)',
    '상태',
    '비고'
  ];

  const breakerSubHeader = [
    '', '', '', '', '', '',
    'L1', 'L2', 'L3',
    'R', 'S', 'T', 'N',
    '', '', '', ''
  ];

  // 차단기 데이터
  const breakerRows: any[][] = [breakerHeader, breakerSubHeader];
  
  (record.breakers || []).forEach((breaker, index) => {
    breakerRows.push([
      breaker.breakerNo || (index + 1).toString(),
      breaker.category || '1차',
      breaker.breakerCapacity || 0,
      breaker.loadName || '',
      breaker.type || '',
      breaker.kind || 'MCCB',
      breaker.currentL1 || 0,
      breaker.currentL2 || 0,
      breaker.currentL3 || 0,
      breaker.loadCapacityR || 0,
      breaker.loadCapacityS || 0,
      breaker.loadCapacityT || 0,
      breaker.loadCapacityN || 0,
      '',
      record.grounding || '미점검',
      record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검',
      ''
    ]);
  });

  // 열화상 측정 섹션
  const thermalRows: any[][] = [
    [],
    ['열화상 측정 (측정기 : ' + (record.thermalImage?.equipment || 'KT-352') + ')', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['점검 내용', '변대/가설분전반 전류 및 발열', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  // 부하 합계 정보
  const summaryRows: any[][] = [
    [],
    ['상별 부하 합계 [AV]', record.loadSummary?.phaseLoadSumA || 0, record.loadSummary?.phaseLoadSumB || 0, record.loadSummary?.phaseLoadSumC || 0, '', '', '', '', '', '', '', '', '', '', '', ''],
    ['총 연결 부하 합계[AV]', record.loadSummary?.totalLoadSum || 0, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['상별 부하 분담 [%]', record.loadSummary?.phaseLoadShareA || 0, record.loadSummary?.phaseLoadShareB || 0, record.loadSummary?.phaseLoadShareC || 0, '', '', '', '', '', '', '', '', '', '', '', ''],
  ];

  // 모든 행 결합
  const allRows = [
    ...basicInfoRows,
    ...breakerRows,
    ...thermalRows,
    ...summaryRows
  ];

  const ws = XLSX.utils.aoa_to_sheet(allRows);

  // 열 너비 설정
  ws['!cols'] = [
    { wch: 12 }, // 차단기 No.
    { wch: 12 }, // 구분
    { wch: 12 }, // 차단기 용량
    { wch: 30 }, // 부하명
    { wch: 10 }, // 형식
    { wch: 12 }, // 종류
    { wch: 10 }, // L1
    { wch: 10 }, // L2
    { wch: 10 }, // L3
    { wch: 10 }, // R
    { wch: 10 }, // S
    { wch: 10 }, // T
    { wch: 10 }, // N
    { wch: 15 }, // 접지
    { wch: 10 }, // 상태
    { wch: 20 }, // 비고
    { wch: 20 }  // 추가 열
  ];

  // 셀 병합 및 스타일 설정
  const merges: XLSX.Range[] = [];
  
  // 헤더 병합
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }); // 공사용 가설 분전반
  merges.push({ s: { r: 0, c: 15 }, e: { r: 0, c: 15 } }); // 가설 전기 점검
  
  // 기본 정보 행 병합
  merges.push({ s: { r: 2, c: 1 }, e: { r: 2, c: 15 } }); // PNL NO. 값
  merges.push({ s: { r: 3, c: 1 }, e: { r: 3, c: 15 } }); // PJT명 값
  merges.push({ s: { r: 4, c: 1 }, e: { r: 4, c: 15 } }); // 시공사 값
  merges.push({ s: { r: 5, c: 1 }, e: { r: 5, c: 15 } }); // 관리번호 값
  merges.push({ s: { r: 6, c: 1 }, e: { r: 6, c: 15 } }); // 점검자 값

  // 전류 헤더 병합
  const breakerHeaderRow = basicInfoRows.length;
  merges.push({ s: { r: breakerHeaderRow, c: 6 }, e: { r: breakerHeaderRow, c: 8 } }); // 전류 (A) (후크메가)
  
  // 부하 용량 헤더 병합
  merges.push({ s: { r: breakerHeaderRow, c: 10 }, e: { r: breakerHeaderRow, c: 13 } }); // 부하 용량[W]

  ws['!merges'] = merges;

  XLSX.utils.book_append_sheet(wb, ws, '점검 보고서');

  // 파일 다운로드
  const fileName = `가설전기점검_${record.panelNo}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

export const generateReport = (
  record: InspectionRecord,
  onReportSaved?: (report: ReportHistory) => void
): void => {
  // In Progress 상태는 리포트 생성하지 않음
  if (record.status === 'In Progress') {
    return;
  }

  const reportDate = new Date().toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  // Excel 파일 생성
  generateExcelReport(record);

  // HTML Report 생성 (사진의 엑셀 보고서 형태)
  const htmlContent = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>가설 전기 점검 보고서 - ${record.panelNo}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Malgun Gothic', '맑은 고딕', Arial, sans-serif;
      background: #f5f5f5;
      padding: 20px;
      color: #000;
    }
    .report-container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 20px;
    }
    .header-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding: 15px;
      background: #e8f5e9;
      border: 2px solid #4caf50;
    }
    .header-left {
      font-size: 18px;
      font-weight: bold;
      color: #2e7d32;
    }
    .header-right {
      font-size: 18px;
      font-weight: bold;
      color: #2e7d32;
    }
    .basic-info {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      margin-bottom: 20px;
      padding: 15px;
      background: #f1f8e9;
      border: 1px solid #8bc34a;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 11px;
      font-weight: bold;
      color: #558b2f;
      margin-bottom: 5px;
    }
    .info-value {
      font-size: 14px;
      color: #000;
    }
    .breaker-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 11px;
    }
    .breaker-table th,
    .breaker-table td {
      border: 1px solid #ccc;
      padding: 8px 4px;
      text-align: center;
    }
    .breaker-table th {
      background: #e3f2fd;
      font-weight: bold;
      font-size: 10px;
    }
    .breaker-table .sub-header {
      background: #f5f5f5;
      font-size: 9px;
    }
    .thermal-section {
      margin: 20px 0;
      padding: 15px;
      background: #fff3e0;
      border: 1px solid #ff9800;
    }
    .thermal-title {
      font-weight: bold;
      margin-bottom: 10px;
    }
    .thermal-image {
      max-width: 300px;
      margin-top: 10px;
    }
    .thermal-image img {
      width: 100%;
      height: auto;
      border: 1px solid #ccc;
    }
    .summary-section {
      margin-top: 20px;
      padding: 15px;
      background: #f5f5f5;
      border: 1px solid #9e9e9e;
    }
    .summary-row {
      display: flex;
      gap: 20px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .summary-label {
      font-weight: bold;
      min-width: 150px;
    }
    @media print {
      body {
        padding: 0;
        background: white;
      }
      .report-container {
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header-section">
      <div class="header-left">공사용 가설 분전반</div>
      <div class="header-right">가설 전기 점검</div>
    </div>

    <div class="basic-info">
      <div class="info-item">
        <div class="info-label">PNL NO.</div>
        <div class="info-value">${record.panelNo || ''}</div>
      </div>
      <div class="info-item">
        <div class="info-label">PJT명</div>
        <div class="info-value">${record.projectName || ''}</div>
      </div>
      <div class="info-item">
        <div class="info-label">시공사</div>
        <div class="info-value">${record.contractor || ''}</div>
      </div>
      <div class="info-item">
        <div class="info-label">관리번호 (판넬명)</div>
        <div class="info-value">${record.managementNumber || record.id || ''}</div>
      </div>
    </div>

    <div class="basic-info">
      <div class="info-item" style="grid-column: 1 / -1;">
        <div class="info-label">점검자</div>
        <div class="info-value">${(record.inspectors || []).join(', ') || ''}</div>
      </div>
    </div>

    <table class="breaker-table">
      <thead>
        <tr>
          <th rowspan="2">차단기 No.</th>
          <th rowspan="2">구분<br>(1차, 2차)</th>
          <th rowspan="2">차단기<br>용량[A]</th>
          <th rowspan="2">부하명<br>(고정부하, 이동부하X)</th>
          <th rowspan="2">형식</th>
          <th rowspan="2">종류<br>(MCCB, ELB)</th>
          <th colspan="3">전류 (A)<br>(후크메가)</th>
          <th colspan="4">부하 용량[W]</th>
          <th rowspan="2">접지<br>(외관 점검)</th>
          <th rowspan="2">상태</th>
          <th rowspan="2">비고</th>
        </tr>
        <tr class="sub-header">
          <th>L1</th>
          <th>L2</th>
          <th>L3</th>
          <th>R</th>
          <th>S</th>
          <th>T</th>
          <th>N</th>
        </tr>
      </thead>
      <tbody>
        ${(record.breakers || []).map((breaker, index) => `
        <tr>
          <td>${breaker.breakerNo || (index + 1)}</td>
          <td>${breaker.category || '1차'}</td>
          <td>${breaker.breakerCapacity || 0}</td>
          <td>${breaker.loadName || ''}</td>
          <td>${breaker.type || ''}</td>
          <td>${breaker.kind || 'MCCB'}</td>
          <td>${breaker.currentL1 || 0}</td>
          <td>${breaker.currentL2 || 0}</td>
          <td>${breaker.currentL3 || 0}</td>
          <td>${breaker.loadCapacityR || 0}</td>
          <td>${breaker.loadCapacityS || 0}</td>
          <td>${breaker.loadCapacityT || 0}</td>
          <td>${breaker.loadCapacityN || 0}</td>
          <td>${record.grounding || '미점검'}</td>
          <td>${record.status === 'Complete' ? '양호' : record.status === 'In Progress' ? '점검 중' : '미점검'}</td>
          <td></td>
        </tr>
        `).join('')}
        ${(record.breakers || []).length === 0 ? '<tr><td colspan="16" style="text-align: center; padding: 20px;">차단기 정보가 없습니다.</td></tr>' : ''}
      </tbody>
    </table>

    <div class="thermal-section">
      <div class="thermal-title">열화상 측정 (측정기 : ${record.thermalImage?.equipment || 'KT-352'})</div>
      <div style="margin-top: 5px; font-size: 11px;">점검 내용 : 변대/가설분전반 전류 및 발열</div>
      ${record.thermalImage?.imageUrl ? `
      <div class="thermal-image">
        <img src="${record.thermalImage.imageUrl}" alt="열화상 이미지" />
        <div style="margin-top: 5px; font-size: 10px;">
          온도: ${record.thermalImage.temperature || 0}°C | 
          최대: ${record.thermalImage.maxTemp || 0}°C | 
          최소: ${record.thermalImage.minTemp || 0}°C | 
          방사율: e=${record.thermalImage.emissivity || 0.95} | 
          측정시간: ${record.thermalImage.measurementTime || ''}
        </div>
      </div>
      ` : '<div style="margin-top: 10px; color: #999;">열화상 이미지 없음</div>'}
    </div>

    <div class="summary-section">
      <div class="summary-row">
        <span class="summary-label">상별 부하 합계 [AV]</span>
        <span>A: ${record.loadSummary?.phaseLoadSumA || 0}</span>
        <span>B: ${record.loadSummary?.phaseLoadSumB || 0}</span>
        <span>C: ${record.loadSummary?.phaseLoadSumC || 0}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">총 연결 부하 합계[AV]</span>
        <span>${record.loadSummary?.totalLoadSum || 0}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">상별 부하 분담 [%]</span>
        <span>A: ${record.loadSummary?.phaseLoadShareA || 0}%</span>
        <span>B: ${record.loadSummary?.phaseLoadShareB || 0}%</span>
        <span>C: ${record.loadSummary?.phaseLoadShareC || 0}%</span>
      </div>
    </div>

    <div style="margin-top: 30px; padding: 15px; text-align: center; font-size: 11px; color: #666; border-top: 1px solid #ddd;">
      <p>점검일: ${record.lastInspectionDate || ''}</p>
      <p style="margin-top: 5px;">보고서 생성일: ${reportDate}</p>
    </div>
  </div>
</body>
</html>
  `;

  const newReport = createReportFromRecord(record, htmlContent);
  if (onReportSaved) {
    onReportSaved(newReport);
  } else {
    saveReportToStorage(newReport);
  }

  // Open report in new window
  const reportWindow = window.open('', '_blank');
  if (reportWindow) {
    reportWindow.document.write(htmlContent);
    reportWindow.document.close();
  }
};

// View report in new window
export const viewReport = (report: ReportHistory): void => {
  const viewWindow = window.open('', '_blank');
  if (viewWindow) {
    viewWindow.document.write(report.htmlContent);
    viewWindow.document.close();
  }
};

// Export report to Excel (inspections: in-memory list; omit to fallback to localStorage)
export const exportReportToExcel = (report: ReportHistory, inspections?: InspectionRecord[]): void => {
  const list = inspections ?? JSON.parse(localStorage.getItem('safetyguard_inspections') || '[]');
  const record = list.find((i: InspectionRecord) => i.panelNo === report.boardId);
  if (record) {
    generateExcelReport(record);
  } else {
    alert('해당 분전반 정보를 찾을 수 없습니다.');
  }
};
