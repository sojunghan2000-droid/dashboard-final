import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { InspectionRecord, StatData, QRCodeData, ReportHistory } from '../types';
import BoardList from './BoardList';
import InspectionDetail from './InspectionDetail';
import StatsChart from './StatsChart';
import { ScanLine, Search, FileSpreadsheet, FileUp } from 'lucide-react';
import { generateReport } from '../services/reportService';
import { exportToExcel } from '../services/excelService';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { savePhoto, dataURLToBlob } from '../services/indexedDBService';

interface DashboardProps {
  inspections: InspectionRecord[];
  onUpdateInspections: (inspections: InspectionRecord[]) => void;
  onScan: () => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
  onReportGenerated?: (report: ReportHistory) => void;
  onReportsUpdate?: (reports: ReportHistory[]) => void;
  qrCodes?: QRCodeData[];
  reports?: ReportHistory[];
}

const Dashboard: React.FC<DashboardProps> = ({
  inspections,
  onUpdateInspections,
  onScan,
  selectedInspectionId,
  onSelectionChange,
  onReportGenerated,
  onReportsUpdate,
  qrCodes = [],
  reports = []
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInspectionStatusCollapsed, setIsInspectionStatusCollapsed] = useState(false);

  // Sync external selectedInspectionId with internal state
  useEffect(() => {
    if (selectedInspectionId !== undefined) {
      setSelectedId(selectedInspectionId);
    }
  }, [selectedInspectionId]);

  const handleSelectId = (id: string | null) => {
    setSelectedId(id);
    if (onSelectionChange) {
      onSelectionChange(id);
    }
  };

  // InspectionDetail에서 최신 formData를 저장
  const [currentFormData, setCurrentFormData] = useState<InspectionRecord | null>(null);

  const selectedRecord = useMemo(() => {
    // 먼저 inspections에서 찾기
    const record = inspections.find(i => i.panelNo === selectedId);
    if (record) return record;
    
    // inspections에 없고 currentFormData가 있으면 그것을 사용 (저장 전 임시 상태)
    if (selectedId && currentFormData && currentFormData.panelNo === selectedId) {
      return currentFormData;
    }
    
    return null;
  }, [inspections, selectedId, currentFormData]);

  // InspectionDetail에서 formData 변경 시 호출
  const handleFormDataChange = useCallback((formData: InspectionRecord) => {
    setCurrentFormData(formData);
  }, []);

  const stats: StatData[] = useMemo(() => {
    const counts = inspections.reduce((acc, curr) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return [
      { name: 'Complete', value: counts['Complete'] || 0, color: '#10b981' },
      { name: 'In Progress', value: counts['In Progress'] || 0, color: '#3b82f6' },
      { name: 'Pending', value: counts['Pending'] || 0, color: '#94a3b8' },
    ].filter(d => d.value > 0);
  }, [inspections]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Electron 환경 확인
  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

  /**
   * PNL NO 저장 로직: 항상 직전 1개만 유지 (덮어쓰기)
   * - PNL NO당 저장 데이터는 1개
   * - 새로 저장하면 이전 데이터는 덮어쓰기
   * - 이력 보관 없음
   */
  const handleSave = (updated: InspectionRecord) => {
    try {
      const finalRecord = {
        ...updated,
        lastInspectionDate: updated.status === 'Complete'
          ? new Date().toLocaleString()
          : updated.lastInspectionDate
      };

      // PNL NO 기준으로 중복 제거: 같은 panelNo를 가진 항목은 모두 제거하고 최신 1개만 유지
      const otherInspections = inspections.filter(item => item.panelNo !== selectedId);
      const updatedInspections = [...otherInspections, finalRecord];
      
      // panelNo 기준으로 다시 한 번 중복 제거 (안전장치)
      const uniqueInspections = updatedInspections.filter((inspection, index, self) =>
        index === self.findIndex(i => i.panelNo === inspection.panelNo)
      );

      onUpdateInspections(uniqueInspections);
      
      // 저장 후 currentFormData도 업데이트하여 화면이 사라지지 않도록
      setCurrentFormData(finalRecord);
      
      setTimeout(() => {
        alert(`PNL NO "${selectedId}" 데이터가 저장되었습니다.\n(이전 데이터는 덮어쓰기되었습니다.)`);
      }, 100);
    } catch (error) {
      console.error('Error saving inspection:', error);
      alert('저장 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleGenerateReport = (record: InspectionRecord) => {
    if (record.status !== 'Complete') {
      alert('상태가 Complete일 때만 보고서를 생성할 수 있습니다.');
      return;
    }
    generateReport(record, onReportGenerated);
    setTimeout(() => alert('Report generated and saved successfully!'), 500);
  };

  // HTML 콘텐츠 생성 함수
  const generateHtmlFromData = (
    reportId: string,
    panelNo: string,
    generatedAt: string,
    lastInspectionDate: string,
    loadCause: string,
    memo: string,
    projectName?: string,
    contractor?: string,
    managementNumber?: string,
    inspectors?: string[]
  ): string => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${reportId}</title>
  <style>
    body { 
      font-family: 'Malgun Gothic', Arial, sans-serif; 
      padding: 20px; 
      background-color: #f5f5f5;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { 
      color: #1e40af; 
      border-bottom: 3px solid #1e40af;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .info { 
      margin: 15px 0; 
      padding: 10px;
      background-color: #f9fafb;
      border-left: 4px solid #3b82f6;
      border-radius: 4px;
    }
    .label { 
      font-weight: bold; 
      color: #374151; 
      display: inline-block;
      min-width: 150px;
    }
    .value {
      color: #1f2937;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${reportId}</h1>
    ${projectName && projectName !== '-' ? `<div class="info"><span class="label">PJT명:</span><span class="value">${projectName}</span></div>` : ''}
    ${contractor && contractor !== '-' ? `<div class="info"><span class="label">시공사:</span><span class="value">${contractor}</span></div>` : ''}
    ${managementNumber && managementNumber !== '-' ? `<div class="info"><span class="label">관리번호:</span><span class="value">${managementNumber}</span></div>` : ''}
    ${inspectors && inspectors.length > 0 && inspectors[0] !== '-' ? `<div class="info"><span class="label">점검자:</span><span class="value">${inspectors.join(', ')}</span></div>` : ''}
    <div class="info">
      <span class="label">PNL NO.:</span>
      <span class="value">${panelNo}</span>
    </div>
    <div class="info">
      <span class="label">보고서 생성일:</span>
      <span class="value">${new Date(generatedAt).toLocaleString('ko-KR')}</span>
    </div>
    <div class="info">
      <span class="label">마지막 점검일:</span>
      <span class="value">${lastInspectionDate !== '-' ? lastInspectionDate : '-'}</span>
    </div>
    <div class="info">
      <span class="label">부하 원인:</span>
      <span class="value">${loadCause}</span>
    </div>
    <div class="info">
      <span class="label">점검 조치 사항:</span>
      <span class="value">${memo}</span>
    </div>
  </div>
</body>
</html>
    `.trim();
  };

  // 엑셀 데이터 처리 함수 (공통)
  const processExcelData = async (data: ArrayBuffer) => {
    try {
      const workbook = XLSX.read(data, { type: 'array' });
        
        // 1. 포맷 버전 검증 (메타 시트 확인)
        let formatVersion: string | null = null;
        const metaSheetName = workbook.SheetNames.find(name => 
          name.toLowerCase().includes('meta') || name.toLowerCase().includes('메타')
        );
        
        if (metaSheetName) {
          const metaSheet = workbook.Sheets[metaSheetName];
          const metaData = XLSX.utils.sheet_to_json(metaSheet, { header: 1 }) as any[][];
          const versionRow = metaData.find(row => 
            row[0] && (String(row[0]).includes('포맷') || String(row[0]).includes('version'))
          );
          if (versionRow && versionRow[1]) {
            formatVersion = String(versionRow[1]).trim();
          }
        }

        // 지원 포맷 버전 확인
        const SUPPORTED_VERSION = '1.0';
        if (formatVersion && formatVersion !== SUPPORTED_VERSION) {
          const proceed = confirm(
            `이 파일은 포맷 버전 ${formatVersion}입니다.\n` +
            `현재 지원하는 포맷 버전은 ${SUPPORTED_VERSION}입니다.\n` +
            `구버전 파일이므로 일부 데이터가 제대로 로드되지 않을 수 있습니다.\n\n` +
            `계속하시겠습니까?`
          );
          if (!proceed) {
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            return;
          }
        }

        // 2. 필수 시트 존재 여부 확인
        const requiredSheets = ['검사 현황', 'Inspection Status'];
        const inspectionSheetName = workbook.SheetNames.find(name => 
          requiredSheets.some(req => name.includes(req))
        ) || workbook.SheetNames.find(name => name.includes('검사')) || workbook.SheetNames[0];

        if (!inspectionSheetName) {
          alert('포맷 오류: "검사 현황" 시트를 찾을 수 없습니다.');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }

        const worksheet = workbook.Sheets[inspectionSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (jsonData.length < 2) {
          alert('엑셀 파일에 데이터가 없습니다.');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }

        // 3. 헤더 검증 및 매핑 (스펙에 맞는 컬럼명 확인)
        const headers = jsonData[0] as string[];
        
        // 헤더 매핑 함수 (한국어/영어 모두 지원)
        const findHeaderIndex = (patterns: string[]): number => {
          for (const pattern of patterns) {
            const index = headers.findIndex(h => {
              const header = String(h || '').toLowerCase();
              return patterns.some(p => header.includes(p.toLowerCase()));
            });
            if (index >= 0) return index;
          }
          return -1;
        };

        const idIndex = findHeaderIndex(['pnl no', 'pnl no.', 'id']);
        const statusIndex = findHeaderIndex(['검사 현황', 'status', '상황']);
        const dateIndex = findHeaderIndex(['점검일', 'inspection date', 'date', '일']);
        const welderIndex = findHeaderIndex(['용접기', 'welder']);
        const grinderIndex = findHeaderIndex(['연삭기', 'grinder']);
        const lightIndex = findHeaderIndex(['조명', 'light']);
        const pumpIndex = findHeaderIndex(['펌프', 'pump']);
        const memoIndex = findHeaderIndex(['점검 조치 사항', 'memo', '조치', '사항']);
        const xIndex = findHeaderIndex(['x 좌표', 'position x', 'x']);
        const yIndex = findHeaderIndex(['y 좌표', 'position y', 'y']);

        // 필수 컬럼 검증
        if (idIndex === -1) {
          alert('포맷 오류: 엑셀 파일에서 "PNL NO." 열을 찾을 수 없습니다.\n스펙에 맞는 포맷인지 확인해주세요.');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          return;
        }

        // 포맷 경고 (선택적 필드 누락 시)
        const missingOptionalFields: string[] = [];
        if (statusIndex === -1) missingOptionalFields.push('검사 현황');
        if (dateIndex === -1) missingOptionalFields.push('점검일');
        
        if (missingOptionalFields.length > 0) {
          console.warn('일부 선택적 필드가 누락되었습니다:', missingOptionalFields);
        }

        // 4. 데이터 로드 (부분 로드 정책: 오류 행은 무시)
        const importedRecords: InspectionRecord[] = [];
        const errorRows: number[] = [];

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || !row[idIndex]) {
            errorRows.push(i + 1);
            continue;
          }

          try {
            const panelNo = String(row[idIndex]).trim();
            if (!panelNo) {
              errorRows.push(i + 1);
              continue;
            }

            const status = statusIndex >= 0 ? String(row[statusIndex] || '').trim() : 'Pending';
            const validStatus = ['Complete', 'In Progress', 'Pending'].includes(status) 
              ? status as 'Complete' | 'In Progress' | 'Pending'
              : 'Pending';

            const lastInspectionDate = dateIndex >= 0 ? String(row[dateIndex] || '-').trim() : '-';
            
            const welder = welderIndex >= 0 ? String(row[welderIndex] || '').toLowerCase().includes('yes') : false;
            const grinder = grinderIndex >= 0 ? String(row[grinderIndex] || '').toLowerCase().includes('yes') : false;
            const light = lightIndex >= 0 ? String(row[lightIndex] || '').toLowerCase().includes('yes') : false;
            const pump = pumpIndex >= 0 ? String(row[pumpIndex] || '').toLowerCase().includes('yes') : false;

            const memo = memoIndex >= 0 ? String(row[memoIndex] || '').trim() : '';

            let position: { x: number; y: number } | undefined;
            if (xIndex >= 0 && yIndex >= 0) {
              const xStr = String(row[xIndex] || '').replace('%', '').trim();
              const yStr = String(row[yIndex] || '').replace('%', '').trim();
              const x = parseFloat(xStr);
              const y = parseFloat(yStr);
              if (!isNaN(x) && !isNaN(y)) {
                position = { x, y };
              }
            }

            importedRecords.push({
              panelNo,
              status: validStatus,
              lastInspectionDate,
              loads: { welder, grinder, light, pump },
              photoUrl: null,
              memo,
              position: position || { x: 50, y: 50 }
            });
          } catch (error) {
            console.error(`행 ${i + 1} 처리 오류:`, error);
            errorRows.push(i + 1);
          }
        }

        const existingPanelNos = new Set(inspections.map(i => i.panelNo));
        const updatedInspections = [...inspections];

        importedRecords.forEach(record => {
          const existingIndex = updatedInspections.findIndex(i => i.panelNo === record.panelNo);
          if (existingIndex >= 0) {
            // 기존 항목 업데이트
            updatedInspections[existingIndex] = {
              ...updatedInspections[existingIndex],
              ...record,
              photoUrl: updatedInspections[existingIndex].photoUrl // 기존 사진 유지
            };
          } else {
            // 새 항목 추가
            updatedInspections.push(record);
          }
        });

        // 4.5. Photos 시트에서 이미지 읽기 (ExcelJS 사용)
        const photosSheetName = workbook.SheetNames.find(name => 
          name.toLowerCase().includes('photos') || name.toLowerCase().includes('사진')
        );
        
        if (photosSheetName) {
          try {
                // ExcelJS로 이미지 추출을 위해 파일을 다시 읽기
                const exceljsWorkbook = new ExcelJS.Workbook();
                await exceljsWorkbook.xlsx.load(data);
                const photosSheet = exceljsWorkbook.getWorksheet(photosSheetName);
                
                // workbook의 media 객체 확인 (이미지 데이터 저장소)
                const media = (exceljsWorkbook as any).model?.media || [];
                console.log(`Workbook media 개수: ${media.length}`);
            
            if (photosSheet) {
              // Photos 시트의 데이터 읽기 (XLSX로)
              const photosData = XLSX.utils.sheet_to_json(workbook.Sheets[photosSheetName], { header: 1 }) as any[][];
              
              if (photosData.length > 1) {
                const photosHeaders = photosData[0] as string[];
                const panelNoIndex = photosHeaders.findIndex(h => 
                  String(h || '').toLowerCase().includes('pnl no') || 
                  String(h || '').toLowerCase().includes('id')
                );
                const photoTypeIndex = photosHeaders.findIndex(h => 
                  String(h || '').toLowerCase().includes('사진 종류') || 
                  String(h || '').toLowerCase().includes('photo type')
                );
                const hasPhotoIndex = photosHeaders.findIndex(h => 
                  String(h || '').toLowerCase().includes('사진 존재') || 
                  String(h || '').toLowerCase().includes('has photo')
                );
                
                // 모든 이미지 가져오기
                const images = photosSheet.getImages();
                console.log(`Photos 시트에서 ${images.length}개의 이미지 발견`);
                
                // 디버깅: 모든 이미지의 위치 정보 출력
                images.forEach((img, idx) => {
                  const imgTop = img.range.tl.nativeRow;
                  const imgBottom = img.range.br.nativeRow;
                  const imgLeft = img.range.tl.nativeCol;
                  const imgRight = img.range.br.nativeCol;
                  console.log(`이미지 ${idx + 1}: 행 ${imgTop + 1}-${imgBottom + 1}, 열 ${imgLeft + 1}-${imgRight + 1} (nativeRow: ${imgTop}-${imgBottom}, nativeCol: ${imgLeft}-${imgRight})`);
                });
                
                // 각 행의 이미지 추출 (헤더 제외, 2행부터 시작)
                for (let dataRowIndex = 1; dataRowIndex < photosData.length; dataRowIndex++) {
                  const row = photosData[dataRowIndex];
                  if (!row || !row[panelNoIndex]) continue;
                  
                  const panelNo = String(row[panelNoIndex] || '').trim();
                  const photoType = photoTypeIndex >= 0 ? String(row[photoTypeIndex] || '').trim() : '';
                  const hasPhoto = hasPhotoIndex >= 0 ? String(row[hasPhotoIndex] || '').toLowerCase().includes('yes') : false;
                  
                  if (!panelNo || !hasPhoto) continue;
                  
                  // ExcelJS 행 번호는 0-based: 헤더=0행, 데이터 1행부터
                  // dataRowIndex 1 = photosData[1] = Excel 2행 = nativeRow 1
                  const nativeRowForData = dataRowIndex; // 0-based, ExcelJS와 동일
                  
                  // 해당 inspection 찾기
                  const inspectionIndex = updatedInspections.findIndex(ins => ins.panelNo === panelNo);
                  if (inspectionIndex < 0) {
                    console.warn(`PNL NO ${panelNo}에 해당하는 inspection을 찾을 수 없습니다.`);
                    continue;
                  }
                  
                  // 이미지 찾기 (C열 또는 D열에 있을 수 있음, 3열 또는 4열)
                  // ExcelJS nativeRow/nativeCol은 0-based. dataRowIndex와 동일 단위 사용
                  const imageForRow = images.find(img => {
                    const imgTop = img.range.tl.nativeRow; // 0-based
                    const imgBottom = img.range.br.nativeRow; // 0-based
                    const imgLeft = img.range.tl.nativeCol; // 0-based (A=0, B=1, C=2, D=3)
                    const imgRight = img.range.br.nativeCol; // 0-based
                    
                    // 이미지가 C열(2) 또는 D열(3)에 있고, 행 범위에 포함되는지 확인
                    const isInColumn = (imgLeft <= 2 && imgRight >= 2) || (imgLeft <= 3 && imgRight >= 3);
                    const isInRow = imgTop <= nativeRowForData && nativeRowForData <= imgBottom;
                    
                    if (isInColumn && isInRow) {
                      console.log(`이미지 매칭 성공: PNL NO ${panelNo}, 행 ${nativeRowForData + 1} (nativeRow: ${nativeRowForData}), 이미지 범위 행 ${imgTop + 1}-${imgBottom + 1}, 열 ${imgLeft + 1}-${imgRight + 1}`);
                      // 이미지 객체 확인
                      console.log(`이미지 객체:`, { 
                        hasImage: !!img.image, 
                        imageType: typeof img.image,
                        imageKeys: img.image ? Object.keys(img.image) : []
                      });
                    }
                    
                    return isInColumn && isInRow;
                  });
                  
                  // 이미지 객체 확인 및 처리
                  if (imageForRow) {
                    try {
                      // ExcelJS의 이미지 객체는 imageId를 가지고 있음
                      const imageId = (imageForRow as any).imageId;
                      console.log(`PNL NO ${panelNo}: imageId = ${imageId}`);
                      
                      // workbook의 media 배열에서 이미지 찾기
                      const media = (exceljsWorkbook as any).model?.media || [];
                      let imageData: any = null;
                      
                      if (imageId !== undefined && media[imageId]) {
                        imageData = media[imageId];
                        console.log(`이미지 데이터 찾음: imageId ${imageId}, 타입: ${imageData.type || 'unknown'}`);
                      } else {
                        // imageId로 직접 찾기 시도
                        const foundMedia = media.find((m: any, idx: number) => idx === imageId);
                        if (foundMedia) {
                          imageData = foundMedia;
                          console.log(`이미지 데이터 찾음 (직접 검색): imageId ${imageId}`);
                        } else {
                          console.warn(`PNL NO ${panelNo}: imageId ${imageId}에 해당하는 이미지 데이터를 찾을 수 없습니다.`);
                          console.log(`사용 가능한 media 인덱스: 0-${media.length - 1}`);
                        }
                      }
                      
                      if (imageData) {
                        // 이미지 데이터에서 buffer 또는 base64 추출
                        let imageBuffer: ArrayBuffer | null = null;
                        let extension = 'png';
                        
                        // buffer 속성 확인
                        if (imageData.buffer) {
                          imageBuffer = imageData.buffer;
                        } else if (imageData.base64) {
                          // base64가 직접 있는 경우
                          const base64 = imageData.base64;
                          extension = imageData.extension || 'png';
                          const dataUrl = `data:image/${extension};base64,${base64}`;
                          const blob = dataURLToBlob(dataUrl);
                          
                          if (photoType.includes('현장사진') || photoType.toLowerCase().includes('site') || !photoType.includes('열화상')) {
                            updatedInspections[inspectionIndex].photoUrl = dataUrl;
                            const existingThermalBlob = updatedInspections[inspectionIndex].thermalImage?.imageUrl
                              ? dataURLToBlob(updatedInspections[inspectionIndex].thermalImage.imageUrl)
                              : null;
                            await savePhoto(panelNo, blob, existingThermalBlob);
                            console.log(`현장사진 저장 완료: ${panelNo}`);
                          } else if (photoType.includes('열화상') || photoType.toLowerCase().includes('thermal')) {
                            if (!updatedInspections[inspectionIndex].thermalImage) {
                              updatedInspections[inspectionIndex].thermalImage = {
                                imageUrl: dataUrl,
                                temperature: 0,
                                maxTemp: 0,
                                minTemp: 0,
                                emissivity: 0.95,
                                measurementTime: new Date().toISOString(),
                                equipment: ''
                              };
                            } else {
                              updatedInspections[inspectionIndex].thermalImage.imageUrl = dataUrl;
                            }
                            const existingPhotoBlob = updatedInspections[inspectionIndex].photoUrl
                              ? dataURLToBlob(updatedInspections[inspectionIndex].photoUrl)
                              : null;
                            await savePhoto(panelNo, existingPhotoBlob, blob);
                            console.log(`열화상 이미지 저장 완료: ${panelNo}`);
                          }
                          continue; // base64 처리 완료, 다음 행으로
                        } else {
                          console.warn(`PNL NO ${panelNo}: 이미지 데이터에 buffer나 base64가 없습니다.`, imageData);
                        }
                        
                        // buffer가 있는 경우 처리
                        if (imageBuffer) {
                          // ArrayBuffer를 Base64로 변환
                          const bytes = new Uint8Array(imageBuffer);
                          let binary = '';
                          for (let i = 0; i < bytes.length; i++) {
                            binary += String.fromCharCode(bytes[i]);
                          }
                          const base64 = btoa(binary);
                          extension = imageData.extension || 'png';
                          const dataUrl = `data:image/${extension};base64,${base64}`;
                          
                          // Blob으로 변환하여 IndexedDB에 저장
                          const blob = dataURLToBlob(dataUrl);
                          
                          if (photoType.includes('현장사진') || photoType.toLowerCase().includes('site') || !photoType.includes('열화상')) {
                            // 현장사진 저장
                            updatedInspections[inspectionIndex].photoUrl = dataUrl;
                            const existingThermalBlob = updatedInspections[inspectionIndex].thermalImage?.imageUrl
                              ? dataURLToBlob(updatedInspections[inspectionIndex].thermalImage.imageUrl)
                              : null;
                            await savePhoto(panelNo, blob, existingThermalBlob);
                            console.log(`현장사진 저장 완료: ${panelNo}`);
                          } else if (photoType.includes('열화상') || photoType.toLowerCase().includes('thermal')) {
                            // 열화상 이미지 저장
                            if (!updatedInspections[inspectionIndex].thermalImage) {
                              updatedInspections[inspectionIndex].thermalImage = {
                                imageUrl: dataUrl,
                                temperature: 0,
                                maxTemp: 0,
                                minTemp: 0,
                                emissivity: 0.95,
                                measurementTime: new Date().toISOString(),
                                equipment: ''
                              };
                            } else {
                              updatedInspections[inspectionIndex].thermalImage.imageUrl = dataUrl;
                            }
                            const existingPhotoBlob = updatedInspections[inspectionIndex].photoUrl
                              ? dataURLToBlob(updatedInspections[inspectionIndex].photoUrl)
                              : null;
                            await savePhoto(panelNo, existingPhotoBlob, blob);
                            console.log(`열화상 이미지 저장 완료: ${panelNo}`);
                          }
                        }
                      } else {
                        console.warn(`PNL NO ${panelNo}: 이미지 데이터를 찾을 수 없습니다.`);
                      }
                    } catch (error) {
                      console.error(`이미지 추출 오류 (${panelNo}, ${photoType}):`, error);
                    }
                  } else {
                    // 이미지를 찾지 못한 경우, 더 넓은 범위로 검색 시도
                    const imageForRowWide = images.find(img => {
                      const imgTop = img.range.tl.nativeRow;
                      const imgBottom = img.range.br.nativeRow;
                      const imgLeft = img.range.tl.nativeCol;
                      const imgRight = img.range.br.nativeCol;
                      
                      // 더 넓은 범위로 검색 (행 ±1, 열 C-D)
                      const isInColumn = (imgLeft <= 3 && imgRight >= 2);
                      const isInRow = Math.abs(imgTop - excelRowNum) <= 1 || Math.abs(imgBottom - excelRowNum) <= 1;
                      
                      return isInColumn && isInRow;
                    });
                    
                    if (imageForRowWide && imageForRowWide.image) {
                      console.log(`이미지 매칭 성공 (넓은 범위): PNL NO ${panelNo}, 행 ${excelRowNum + 1}`);
                      // 이미지 처리 로직은 동일
                      try {
                        const imageBuffer = imageForRowWide.image.buffer;
                        const bytes = new Uint8Array(imageBuffer);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) {
                          binary += String.fromCharCode(bytes[i]);
                        }
                        const base64 = btoa(binary);
                        const extension = imageForRowWide.image.extension || 'png';
                        const dataUrl = `data:image/${extension};base64,${base64}`;
                        const blob = dataURLToBlob(dataUrl);
                        
                        if (photoType.includes('현장사진') || photoType.toLowerCase().includes('site') || !photoType.includes('열화상')) {
                          updatedInspections[inspectionIndex].photoUrl = dataUrl;
                          const existingThermalBlob = updatedInspections[inspectionIndex].thermalImage?.imageUrl
                            ? dataURLToBlob(updatedInspections[inspectionIndex].thermalImage.imageUrl)
                            : null;
                          await savePhoto(panelNo, blob, existingThermalBlob);
                          console.log(`현장사진 저장 완료: ${panelNo}`);
                        } else if (photoType.includes('열화상') || photoType.toLowerCase().includes('thermal')) {
                          if (!updatedInspections[inspectionIndex].thermalImage) {
                            updatedInspections[inspectionIndex].thermalImage = {
                              imageUrl: dataUrl,
                              temperature: 0,
                              maxTemp: 0,
                              minTemp: 0,
                              emissivity: 0.95,
                              measurementTime: new Date().toISOString(),
                              equipment: ''
                            };
                          } else {
                            updatedInspections[inspectionIndex].thermalImage.imageUrl = dataUrl;
                          }
                          const existingPhotoBlob = updatedInspections[inspectionIndex].photoUrl
                            ? dataURLToBlob(updatedInspections[inspectionIndex].photoUrl)
                            : null;
                          await savePhoto(panelNo, existingPhotoBlob, blob);
                          console.log(`열화상 이미지 저장 완료: ${panelNo}`);
                        }
                      } catch (error) {
                        console.error(`이미지 추출 오류 (${panelNo}, ${photoType}):`, error);
                      }
                    } else {
                      console.warn(`PNL NO ${panelNo}의 ${photoType} 이미지를 찾을 수 없습니다. (행 ${excelRowNum + 1} (ExcelJS: ${excelRowNum}), 전체 이미지 수: ${images.length})`);
                      // 사용 가능한 이미지 위치 정보 출력
                      if (images.length > 0) {
                        console.log('사용 가능한 이미지 위치:');
                        images.forEach((img, idx) => {
                          console.log(`  이미지 ${idx + 1}: 행 ${img.range.tl.nativeRow + 1}-${img.range.br.nativeRow + 1}, 열 ${img.range.tl.nativeCol + 1}-${img.range.br.nativeCol + 1}`);
                        });
                      }
                    }
                  }
                }
                
                // 이미지가 업데이트된 inspections 다시 저장
                const hasUpdatedPhotos = updatedInspections.some(ins => ins.photoUrl || ins.thermalImage?.imageUrl);
                if (hasUpdatedPhotos) {
                  onUpdateInspections(updatedInspections);
                  console.log('Photos 시트에서 이미지 읽기 완료');
                } else {
                  console.warn('Photos 시트에서 이미지를 찾을 수 없거나 추출에 실패했습니다.');
                }
              }
            }
          } catch (error) {
            console.error('Photos 시트 읽기 오류:', error);
            alert('Photos 시트에서 이미지를 읽는 중 오류가 발생했습니다. 콘솔을 확인해주세요.');
            // Photos 시트 읽기 실패는 경고만 하고 계속 진행
          }
        }
        
        onUpdateInspections(updatedInspections);
        
        // 5. Reports 시트 읽기 (있는 경우)
        const reportsSheetName = workbook.SheetNames.find(name => 
          name.toLowerCase().includes('reports') || name.toLowerCase().includes('보고서')
        );
        
        if (reportsSheetName && onReportsUpdate) {
          try {
            const reportsSheet = workbook.Sheets[reportsSheetName];
            const reportsData = XLSX.utils.sheet_to_json(reportsSheet, { header: 1 }) as any[][];
            
            if (reportsData.length > 1) {
              const reportsHeaders = reportsData[0] as string[];
              
              // 헤더 인덱스 찾기
              const findReportsHeaderIndex = (patterns: string[]): number => {
                for (const pattern of patterns) {
                  const index = reportsHeaders.findIndex(h => {
                    const header = String(h || '').toLowerCase();
                    return patterns.some(p => header.includes(p.toLowerCase()));
                  });
                  if (index >= 0) return index;
                }
                return -1;
              };
              
              const reportIdIndex = findReportsHeaderIndex(['report id', '보고서 id', 'reportid']);
              const generatedAtIndex = findReportsHeaderIndex(['보고서 생성일', 'generated at', '생성일', 'generated']);
              const panelNoIndex = findReportsHeaderIndex(['pnl no', 'pnl no.', 'id', 'board id']);
              const statusIndex = findReportsHeaderIndex(['status', '상태', '검사 현황']);
              const htmlContentBase64Index = findReportsHeaderIndex(['html content', 'html', 'base64']);
              const projectNameIndex = findReportsHeaderIndex(['pjt명', 'project name', 'pjt', 'pjt명']);
              const contractorIndex = findReportsHeaderIndex(['시공사', 'contractor']);
              const managementNumberIndex = findReportsHeaderIndex(['관리번호', 'management number', '판넬명']);
              const inspectorsIndex = findReportsHeaderIndex(['점검자', 'inspectors']);
              
              const importedReports: ReportHistory[] = [];
              
              for (let i = 1; i < reportsData.length; i++) {
                const row = reportsData[i];
                if (!row || !row[panelNoIndex]) continue;
                
                try {
                  const panelNo = String(row[panelNoIndex] || '').trim();
                  const reportId = reportIdIndex >= 0 ? String(row[reportIdIndex] || '').trim() : '';
                  const generatedAtStr = generatedAtIndex >= 0 
                    ? String(row[generatedAtIndex] || '').trim() 
                    : '';
                  
                  if (panelNo && reportId) {
                    // 날짜 파싱 시도
                    let generatedAt: string;
                    if (generatedAtStr) {
                      try {
                        const date = new Date(generatedAtStr);
                        generatedAt = isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
                      } catch {
                        generatedAt = new Date().toISOString();
                      }
                    } else {
                      generatedAt = new Date().toISOString();
                    }
                    
                    // 상태 파싱
                    const statusStr = statusIndex >= 0 ? String(row[statusIndex] || '').trim() : 'Complete';
                    const validStatus = ['Complete', 'In Progress', 'Pending'].includes(statusStr)
                      ? statusStr as 'Complete' | 'In Progress' | 'Pending'
                      : 'Complete';
                    
                    // 해당 inspection 찾기
                    const matchingInspection = updatedInspections.find(ins => ins.panelNo === panelNo);
                    
                    // Reports 시트에서 추가 데이터 읽기
                    const loadCauseIndex = findReportsHeaderIndex(['부하 원인', 'load cause', 'load']);
                    const memoIndex = findReportsHeaderIndex(['점검 조치 사항', 'memo', '조치', '사항']);
                    const lastInspectionDateIndex = findReportsHeaderIndex(['마지막 점검일', 'last inspection date', 'inspection date']);
                    
                    const loadCause = loadCauseIndex >= 0 ? String(row[loadCauseIndex] || '').trim() : 
                      (matchingInspection 
                        ? [
                            matchingInspection.loads.welder ? 'Welder' : null,
                            matchingInspection.loads.grinder ? 'Grinder' : null,
                            matchingInspection.loads.light ? 'Light' : null,
                            matchingInspection.loads.pump ? 'Pump' : null,
                          ].filter(Boolean).join(', ') || 'None'
                        : 'Unknown');
                    
                    const memo = memoIndex >= 0 ? String(row[memoIndex] || '').trim() : (matchingInspection?.memo || '-');
                    const lastInspectionDate = lastInspectionDateIndex >= 0 
                      ? String(row[lastInspectionDateIndex] || '').trim() 
                      : (matchingInspection?.lastInspectionDate || '-');
                    
                    // 추가 정보 읽기
                    const projectName = projectNameIndex >= 0 ? String(row[projectNameIndex] || '').trim() : 
                      (matchingInspection?.projectName || '');
                    const contractor = contractorIndex >= 0 ? String(row[contractorIndex] || '').trim() : 
                      (matchingInspection?.contractor || '');
                    const managementNumber = managementNumberIndex >= 0 ? String(row[managementNumberIndex] || '').trim() : 
                      (matchingInspection?.managementNumber || '');
                    const inspectorsStr = inspectorsIndex >= 0 ? String(row[inspectorsIndex] || '').trim() : 
                      ((matchingInspection?.inspectors || []).join(', ') || '');
                    const inspectors = inspectorsStr ? inspectorsStr.split(',').map(s => s.trim()).filter(s => s) : [];
                    
                    // InspectionRecord에 추가 정보 반영
                    if (matchingInspection) {
                      const inspectionIndex = updatedInspections.findIndex(ins => ins.panelNo === panelNo);
                      if (inspectionIndex >= 0) {
                        updatedInspections[inspectionIndex] = {
                          ...updatedInspections[inspectionIndex],
                          projectName: projectName || updatedInspections[inspectionIndex].projectName,
                          contractor: contractor || updatedInspections[inspectionIndex].contractor,
                          managementNumber: managementNumber || updatedInspections[inspectionIndex].managementNumber,
                          inspectors: inspectors.length > 0 ? inspectors : updatedInspections[inspectionIndex].inspectors,
                        };
                      }
                    }
                    
                    // HTML 콘텐츠 읽기 (Base64 디코딩 시도)
                    let htmlContent = '';
                    if (htmlContentBase64Index >= 0 && row[htmlContentBase64Index]) {
                      try {
                        let base64Content = String(row[htmlContentBase64Index] || '').trim();
                        
                        // Base64 문자열 정리 (공백, 줄바꿈 제거)
                        base64Content = base64Content.replace(/\s+/g, '');
                        
                        // 빈 문자열 체크
                        if (!base64Content || base64Content === '-') {
                          throw new Error('Base64 콘텐츠가 비어있습니다.');
                        }
                        
                        // Base64 형식 검증 (Base64는 A-Z, a-z, 0-9, +, /, = 만 포함)
                        const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                        if (!base64Regex.test(base64Content)) {
                          throw new Error('유효하지 않은 Base64 형식입니다.');
                        }
                        
                        // Base64 디코딩
                        htmlContent = decodeURIComponent(escape(atob(base64Content)));
                        
                        // 디코딩된 HTML이 비어있는지 확인
                        if (!htmlContent || htmlContent.trim().length === 0) {
                          throw new Error('디코딩된 HTML 콘텐츠가 비어있습니다.');
                        }
                      } catch (error) {
                        console.error('HTML 콘텐츠 디코딩 오류:', error);
                        console.log('Base64 콘텐츠 (처음 100자):', String(row[htmlContentBase64Index] || '').substring(0, 100));
                        // 디코딩 실패 시 기존 방식으로 HTML 생성
                        htmlContent = generateHtmlFromData(
                          reportId,
                          panelNo,
                          generatedAt,
                          lastInspectionDate,
                          loadCause,
                          memo,
                          projectName,
                          contractor,
                          managementNumber,
                          inspectors
                        );
                      }
                    } else {
                      // HTML 콘텐츠가 없으면 기존 방식으로 생성
                      htmlContent = generateHtmlFromData(
                        reportId,
                        panelNo,
                        generatedAt,
                        lastInspectionDate,
                        loadCause,
                        memo,
                        projectName,
                        contractor,
                        managementNumber,
                        inspectors
                      );
                    }
                    
                    importedReports.push({
                      id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                      reportId,
                      boardId: panelNo,
                      generatedAt,
                      status: matchingInspection?.status || validStatus,
                      htmlContent: htmlContent
                    });
                  }
                } catch (error) {
                  console.error(`Reports 행 ${i + 1} 처리 오류:`, error);
                }
              }
              
              if (importedReports.length > 0) {
                // 기존 reports와 병합 (같은 reportId는 업데이트)
                const existingReports = reports || [];
                const reportMap = new Map<string, ReportHistory>();
                
                // 기존 reports를 맵에 추가
                existingReports.forEach(report => {
                  reportMap.set(report.reportId, report);
                });
                
                // 새로운 reports로 업데이트 (같은 reportId가 있으면 덮어쓰기)
                importedReports.forEach(report => {
                  reportMap.set(report.reportId, report);
                });
                
                const mergedReports = Array.from(reportMap.values());
                onReportsUpdate(mergedReports);
              }
            }
          } catch (error) {
            console.error('Reports 시트 읽기 오류:', error);
            // Reports 시트 읽기 실패는 경고만 하고 계속 진행
          }
        }
        
        // 결과 메시지
        let message = `${importedRecords.length}개의 분전함 데이터를 가져왔습니다.`;
        if (errorRows.length > 0) {
          message += `\n\n경고: ${errorRows.length}개의 행에서 오류가 발생하여 무시되었습니다.`;
          if (errorRows.length <= 10) {
            message += `\n오류 행: ${errorRows.join(', ')}`;
          } else {
            message += `\n오류 행: ${errorRows.slice(0, 10).join(', ')} 외 ${errorRows.length - 10}개`;
          }
        }
        alert(message);
        
        // 파일 입력 초기화
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } catch (error) {
        console.error('엑셀 파일 읽기 오류:', error);
        alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
      }
  };

  // Electron 환경에서 파일 열기
  const handleElectronFileImport = async () => {
    if (!isElectron) return;
    
    setIsImporting(true);
    try {
      const result = await window.electronAPI!.openExcelFile();
      
      if (!result.success || result.canceled) {
        setIsImporting(false);
        return;
      }

      // ArrayBuffer로 변환
      const buffer = new Uint8Array(result.buffer).buffer;
      await processExcelData(buffer);
    } catch (error) {
      console.error('파일 열기 오류:', error);
      alert('파일 열기 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsImporting(false);
    }
  };

  // 웹 환경에서 파일 입력
  const handleExcelImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result as ArrayBuffer;
        await processExcelData(data);
      } catch (error) {
        console.error('엑셀 파일 읽기 오류:', error);
        alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 h-full min-h-0">
      {/* Left Panel: Stats & List */}
      <div className={`
        ${selectedId ? 'hidden lg:flex' : 'flex'} 
        lg:col-span-4 flex-col gap-4 md:gap-6 h-full min-h-0
      `}>
        {/* Action Buttons - 엑셀 버튼은 App.tsx header로 이동됨 */}
        {/* 엑셀 입력 버튼 (App.tsx에서 트리거 가능하도록 data 속성 추가) */}
        {isElectron ? (
          <button
            data-excel-import-button
            onClick={handleElectronFileImport}
            disabled={isImporting}
            className="hidden"
          >
            엑셀 입력
          </button>
        ) : (
          <label 
            data-excel-import-button
            className="hidden"
          >
            엑셀 입력
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelImport}
              className="hidden"
              disabled={isImporting}
            />
          </label>
        )}

        {/* Stats Card - Collapsible */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 shrink-0 overflow-hidden">
          <button
            onClick={() => setIsInspectionStatusCollapsed(!isInspectionStatusCollapsed)}
            className="w-full p-4 md:p-5 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Inspection Status</h3>
            <svg
              className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${isInspectionStatusCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {!isInspectionStatusCollapsed && (
            <div className="px-4 md:px-5 pb-4 md:pb-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="w-full sm:w-1/2 min-h-[180px] md:min-h-[200px]">
                  <StatsChart data={stats} />
                </div>
                <div className="w-full sm:w-1/2 space-y-2">
                  {stats.map(s => (
                    <div key={s.name} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></span>
                        <span className="text-slate-600 font-medium">{s.name}</span>
                      </div>
                      <span className="font-bold text-slate-800">{s.value}</span>
                    </div>
                  ))}
                  <div className="pt-2 mt-2 border-t border-slate-100 flex justify-between items-center text-sm">
                    <span className="text-slate-500">Total</span>
                    <span className="font-bold text-slate-900">{inspections.length}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* List Component */}
        <div className="flex-1 min-h-0">
          <BoardList 
            items={inspections} 
            selectedId={selectedId} 
            onSelect={handleSelectId} 
          />
        </div>
      </div>

      {/* Right Panel: Detail View */}
      <div className={`
        ${selectedId ? 'flex' : 'hidden lg:flex'} 
        lg:col-span-8 h-full min-h-0 flex-col overflow-hidden
      `}>
        {(() => {
          // 안전하게 record 가져오기
          const recordToUse = selectedRecord || (selectedId && currentFormData ? currentFormData : null);
          
          if (!recordToUse) {
            return (
              <div className="h-full flex flex-col items-center justify-center bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
                <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                  <Search size={32} className="text-slate-400" />
                </div>
                <p className="font-medium">Select a Distribution Board to view details</p>
                <p className="text-sm mt-2">Or scan a new QR code</p>
              </div>
            );
          }

          return (
            <InspectionDetail 
              record={recordToUse} 
            onSave={(updated) => {
              try {
                handleSave(updated);
              } catch (error) {
                console.error('Save error:', error);
                alert('저장 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : String(error)));
              }
            }}
            onGenerateReport={(record) => {
              try {
                handleGenerateReport(record);
              } catch (error) {
                console.error('Generate report error:', error);
                alert('보고서 생성 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : String(error)));
              }
            }}
            onCancel={() => {
              try {
                // Cancel 시 currentFormData도 초기화
                setCurrentFormData(null);
                handleSelectId(null);
              } catch (error) {
                console.error('Cancel error:', error);
              }
            }}
            onFormDataChange={handleFormDataChange}
          />
          );
        })()}
      </div>
    </div>
  );
};

export default Dashboard;
