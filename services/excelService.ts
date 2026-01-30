import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { InspectionRecord, QRCodeData, ReportHistory } from '../types';

const STORAGE_KEY = 'safetyguard_qrcodes';
const REPORTS_STORAGE_KEY = 'safetyguard_reports';
const INSPECTIONS_STORAGE_KEY = 'safetyguard_inspections';

// 포맷 버전 정보
const FORMAT_VERSION = '1.0';
const SUPPORTED_FORMAT_VERSION = '1.0';

interface ExcelExportData {
  id: string;
  status: string;
  lastInspectionDate: string;
  welder: string;
  grinder: string;
  light: string;
  pump: string;
  memo: string;
  positionX: string;
  positionY: string;
  qrLocation: string;
  qrFloor: string;
  qrPosition: string;
  qrId: string;
  reportId: string;
  reportGeneratedAt: string;
  loadCause: string; // 부하 원인
}

/**
 * 이미지 URL을 Base64로 변환하는 헬퍼 함수 (ExcelJS용 - 브라우저 환경)
 * ExcelJS는 브라우저에서 base64를 사용하는 것이 더 안전합니다.
 */
const imageUrlToBase64 = async (url: string): Promise<{ base64: string; extension: 'jpeg' | 'png' | 'gif' } | null> => {
  try {
    let base64String: string;
    let extension: 'jpeg' | 'png' | 'gif' = 'jpeg';

    // Base64 데이터 URL인 경우
    if (url.startsWith('data:image')) {
      base64String = url.split(',')[1];
      const mimeType = url.split(',')[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
      if (mimeType.includes('png')) {
        extension = 'png';
      } else if (mimeType.includes('gif')) {
        extension = 'gif';
      } else {
        extension = 'jpeg';
      }
    } else {
      // 외부 URL인 경우 fetch로 가져오기
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const blob = await response.blob();
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('png')) {
        extension = 'png';
      } else if (contentType.includes('gif')) {
        extension = 'gif';
      } else {
        extension = 'jpeg';
      }

      // Blob을 Base64로 변환
      base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // data:image/jpeg;base64, 부분 제거
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }

    return { base64: base64String, extension };
  } catch (error) {
    console.error('이미지 변환 오류:', error);
    return null;
  }
};

/**
 * 엑셀 내보내기 함수
 * 스펙 버전 1.0에 맞춰 엑셀 파일을 생성합니다.
 * 
 * @param inspections 검사 기록 배열
 * @param qrCodesFromProps QR 코드 데이터 (옵션)
 * @param reportsFromProps 보고서 데이터 (옵션)
 * @returns 내보낸 PNL NO 목록 (사진 삭제용)
 */
export const exportToExcel = async (
  inspections: InspectionRecord[],
  qrCodesFromProps?: QRCodeData[],
  reportsFromProps?: ReportHistory[]
): Promise<string[]> => {
  const savedQRCodes: QRCodeData[] = qrCodesFromProps ?? JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  const reports: ReportHistory[] = reportsFromProps ?? JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]');
  
  // Reports를 ID로 매핑
  const reportMap = new Map<string, ReportHistory>();
  reports.forEach(report => {
    reportMap.set(report.boardId, report);
  });
  
  // QR 코드를 ID로 매핑 (QR과 ID는 하나의 객체이므로 ID로 직접 매칭)
  const qrMap = new Map<string, QRCodeData>();
  savedQRCodes.forEach(qr => {
    try {
      const qrData = JSON.parse(qr.qrData);
      if (qrData.id) {
        const matchingInspection = inspections.find(inspection => inspection.panelNo === qrData.id);
        if (matchingInspection) {
          qrMap.set(matchingInspection.panelNo, qr);
        }
      }
    } catch (e) {
      console.error('QR 데이터 파싱 오류:', e);
    }
  });

  // 엑셀 데이터 준비
  const excelData: ExcelExportData[] = inspections.map(inspection => {
    const qr = qrMap.get(inspection.panelNo);
    const report = reportMap.get(inspection.panelNo);
    let qrLocation = '';
    let qrFloor = '';
    let qrPosition = '';
    let qrId = '';

    if (qr) {
      try {
        const qrData = JSON.parse(qr.qrData);
        qrId = qrData.id || inspection.panelNo;
        qrLocation = qrData.location || qr.location || '';
        qrFloor = qrData.floor || qr.floor || '';
        if (typeof qrData.position === 'string') {
          qrPosition = qrData.position;
        } else if (qrData.position && qrData.position.description) {
          qrPosition = qrData.position.description;
        } else {
          qrPosition = qr.position || '';
        }
      } catch (e) {
        qrLocation = qr.location || '';
        qrFloor = qr.floor || '';
        qrPosition = qr.position || '';
        qrId = inspection.panelNo;
      }
    } else {
      qrId = inspection.panelNo;
    }

    // 부하 원인 문자열 생성
    const connectedLoads = [];
    if (inspection.loads.welder) connectedLoads.push('Welder');
    if (inspection.loads.grinder) connectedLoads.push('Grinder');
    if (inspection.loads.light) connectedLoads.push('Light');
    if (inspection.loads.pump) connectedLoads.push('Pump');
    const loadCause = connectedLoads.length > 0 ? connectedLoads.join(', ') : 'None';

    return {
      id: inspection.panelNo,
      status: inspection.status,
      lastInspectionDate: inspection.lastInspectionDate,
      welder: inspection.loads.welder ? 'Yes' : 'No',
      grinder: inspection.loads.grinder ? 'Yes' : 'No',
      light: inspection.loads.light ? 'Yes' : 'No',
      pump: inspection.loads.pump ? 'Yes' : 'No',
      memo: inspection.memo || '',
      positionX: inspection.position ? `${inspection.position.x}%` : '',
      positionY: inspection.position ? `${inspection.position.y}%` : '',
      qrLocation: qrLocation,
      qrFloor: qrFloor,
      qrPosition: qrPosition,
      qrId: qrId,
      reportId: report ? report.reportId : '',
      reportGeneratedAt: report ? new Date(report.generatedAt).toLocaleString('ko-KR') : '',
      loadCause: loadCause, // 부하 원인 추가
    };
  });

  // ExcelJS 워크북 생성
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Panel Inspector';
  workbook.created = new Date();
  workbook.modified = new Date();

  // 0. Meta 시트 생성 (포맷 버전 정보)
  const metaSheet = workbook.addWorksheet('Meta');
  metaSheet.getColumn(1).width = 20;
  metaSheet.getColumn(2).width = 30;
  metaSheet.addRow(['포맷 버전', FORMAT_VERSION]);
  metaSheet.addRow(['지원 포맷 버전', SUPPORTED_FORMAT_VERSION]);
  metaSheet.addRow(['생성일', new Date().toISOString()]);
  metaSheet.addRow(['생성 시간', new Date().toLocaleString('ko-KR')]);

  // 1. Inspection Sheet (검사 현황)
  const inspectionSheet = workbook.addWorksheet('검사 현황');
  inspectionSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: '검사 현황', key: 'status', width: 12 },
    { header: '점검일', key: 'date', width: 18 },
    { header: '용접기', key: 'welder', width: 8 },
    { header: '연삭기', key: 'grinder', width: 8 },
    { header: '조명', key: 'light', width: 8 },
    { header: '펌프', key: 'pump', width: 8 },
    { header: '부하 원인', key: 'loadCause', width: 25 },
    { header: '점검 조치 사항', key: 'memo', width: 30 },
    { header: 'X 좌표 (%)', key: 'positionX', width: 12 },
    { header: 'Y 좌표 (%)', key: 'positionY', width: 12 },
  ];

  // 헤더 스타일 설정
  inspectionSheet.getRow(1).font = { bold: true };
  inspectionSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  excelData.forEach(row => {
    inspectionSheet.addRow({
      id: row.id,
      status: row.status,
      date: row.lastInspectionDate,
      welder: row.welder,
      grinder: row.grinder,
      light: row.light,
      pump: row.pump,
      loadCause: row.loadCause,
      memo: row.memo,
      positionX: row.positionX,
      positionY: row.positionY,
    });
  });

  // 2. QR List Sheet (위치 정보 및 QR)
  const qrListSheet = workbook.addWorksheet('QR List');
  qrListSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: 'QR ID', key: 'qrId', width: 15 },
    { header: 'X 좌표 (%)', key: 'positionX', width: 12 },
    { header: 'Y 좌표 (%)', key: 'positionY', width: 12 },
    { header: 'QR 위치', key: 'qrLocation', width: 15 },
    { header: 'QR 층수', key: 'qrFloor', width: 10 },
    { header: 'QR 위치 정보', key: 'qrPosition', width: 20 },
  ];

  qrListSheet.getRow(1).font = { bold: true };
  qrListSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  excelData.forEach(row => {
    qrListSheet.addRow({
      id: row.id,
      qrId: row.qrId || row.id,
      positionX: row.positionX,
      positionY: row.positionY,
      qrLocation: row.qrLocation || '-',
      qrFloor: row.qrFloor || '-',
      qrPosition: row.qrPosition || '-',
    });
  });

  // 3. Reports Sheet (완료된 검사만 포함)
  const completeInspections = inspections.filter(i => i.status === 'Complete');
  const reportsSheet = workbook.addWorksheet('Reports');
  reportsSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: 'Report ID', key: 'reportId', width: 25 },
    { header: '보고서 생성일', key: 'generatedAt', width: 20 },
    { header: '마지막 점검일', key: 'lastInspectionDate', width: 20 },
    { header: '부하 원인', key: 'loadCause', width: 30 },
    { header: '점검 조치 사항', key: 'memo', width: 40 },
  ];

  reportsSheet.getRow(1).font = { bold: true };
  reportsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  completeInspections.forEach(inspection => {
    const report = reportMap.get(inspection.panelNo);
    const connectedLoads = [];
    if (inspection.loads.welder) connectedLoads.push('Welder');
    if (inspection.loads.grinder) connectedLoads.push('Grinder');
    if (inspection.loads.light) connectedLoads.push('Light');
    if (inspection.loads.pump) connectedLoads.push('Pump');
    const loadCause = connectedLoads.length > 0 ? connectedLoads.join(', ') : 'None';

    reportsSheet.addRow({
      id: inspection.panelNo,
      reportId: report ? report.reportId : '-',
      generatedAt: report ? new Date(report.generatedAt).toLocaleString('ko-KR') : '-',
      lastInspectionDate: inspection.lastInspectionDate !== '-' ? inspection.lastInspectionDate : '-',
      loadCause: loadCause,
      memo: inspection.memo || '-',
    });
  });

  // 4. Photos 시트 생성 (이미지 삽입)
  const photosSheet = workbook.addWorksheet('Photos');
  photosSheet.columns = [
    { header: 'PNL NO.', key: 'id', width: 15 },
    { header: '사진 종류', key: 'photoType', width: 15 },
    { header: '사진', key: 'photo', width: 30 },
    { header: '사진 존재 여부', key: 'hasPhoto', width: 15 },
  ];

  photosSheet.getRow(1).font = { bold: true };
  photosSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8F5E9' }
  };

  // 이미지 삽입을 위한 행 높이 설정
  photosSheet.getRow(1).height = 20;

  // 열 너비 조정
  photosSheet.getColumn(1).width = 15; // A열: PNL NO.
  photosSheet.getColumn(2).width = 15; // B열: 사진 종류
  photosSheet.getColumn(3).width = 30; // C열: 사진
  photosSheet.getColumn(4).width = 15; // D열: 사진 존재 여부

  // 이미지 추가 (각 PNL NO마다 현장사진과 열화상 이미지 모두 처리)
  let currentRow = 2; // 헤더 다음 행부터 시작 (1-based)

  for (let i = 0; i < inspections.length; i++) {
    const inspection = inspections[i];
    let hasAnyPhoto = false;

    // 1. 현장사진 처리
    if (inspection.photoUrl) {
      hasAnyPhoto = true;
      photosSheet.addRow({
        id: inspection.panelNo,
        photoType: '현장사진',
        photo: '',
        hasPhoto: 'Yes',
      });

      try {
        const imageData = await imageUrlToBase64(inspection.photoUrl);
        if (imageData) {
          const imageId = workbook.addImage({
            base64: imageData.base64,
            extension: imageData.extension,
          });

          // C열에 이미지 삽입 (셀 범위: C행:D행)
          photosSheet.addImage(imageId, `C${currentRow}:D${currentRow}`);
          photosSheet.getRow(currentRow).height = 120;
        } else {
          photosSheet.getCell(`D${currentRow}`).value = 'No (로드 실패)';
        }
      } catch (error) {
        console.error(`현장사진 삽입 오류 (${inspection.panelNo}):`, error);
        photosSheet.getCell(`D${currentRow}`).value = 'No (오류: ' + (error instanceof Error ? error.message : String(error)) + ')';
      }
      currentRow++;
    }

    // 2. 열화상 이미지 처리
    if (inspection.thermalImage?.imageUrl) {
      hasAnyPhoto = true;
      photosSheet.addRow({
        id: inspection.panelNo,
        photoType: '열화상 이미지',
        photo: '',
        hasPhoto: 'Yes',
      });

      try {
        const imageData = await imageUrlToBase64(inspection.thermalImage.imageUrl);
        if (imageData) {
          const imageId = workbook.addImage({
            base64: imageData.base64,
            extension: imageData.extension,
          });

          // C열에 이미지 삽입 (셀 범위: C행:D행)
          photosSheet.addImage(imageId, `C${currentRow}:D${currentRow}`);
          photosSheet.getRow(currentRow).height = 120;
        } else {
          photosSheet.getCell(`D${currentRow}`).value = 'No (로드 실패)';
        }
      } catch (error) {
        console.error(`열화상 이미지 삽입 오류 (${inspection.panelNo}):`, error);
        photosSheet.getCell(`D${currentRow}`).value = 'No (오류: ' + (error instanceof Error ? error.message : String(error)) + ')';
      }
      currentRow++;
    }

    // 사진이 하나도 없는 경우
    if (!hasAnyPhoto) {
      photosSheet.addRow({
        id: inspection.panelNo,
        photoType: '-',
        photo: '',
        hasPhoto: 'No',
      });
      currentRow++;
    }
  }

  // 파일 다운로드
  const fileName = `분전함_검사현황_v${FORMAT_VERSION}_${new Date().toISOString().split('T')[0]}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  
  // Blob 생성 및 다운로드
  const blob = new Blob([buffer], { 
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);

  // 내보낸 PNL NO 목록 반환 (사진 삭제용)
  return inspections.map(i => i.panelNo);
};

/**
 * 엑셀 내보내기 완료 후 로컬 사진 삭제 (옵션 A: 사진만 삭제)
 * 텍스트/숫자 데이터는 유지하고 이미지 Blob/Base64만 제거합니다.
 * 
 * @param panelNos 삭제할 PNL NO 목록
 * @param inspections 검사 기록 배열 (업데이트용)
 * @returns 사진이 삭제된 검사 기록 배열
 */
export const deleteLocalPhotosAfterExport = (
  panelNos: string[],
  inspections: InspectionRecord[]
): InspectionRecord[] => {
  return inspections.map(inspection => {
    if (panelNos.includes(inspection.panelNo)) {
      // 사진만 삭제하고 나머지 데이터는 유지
      return {
        ...inspection,
        photoUrl: null
      };
    }
    return inspection;
  });
};
