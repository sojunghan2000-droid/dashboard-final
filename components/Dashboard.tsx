import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { InspectionRecord, StatData, QRCodeData, ReportHistory } from '../types';
import BoardList from './BoardList';
import InspectionDetail from './InspectionDetail';
import StatsChart from './StatsChart';
import { ScanLine, Search, FileSpreadsheet, FileUp } from 'lucide-react';
import { generateReport } from '../services/reportService';
import { exportToExcel, deleteLocalPhotosAfterExport } from '../services/excelService';
import * as XLSX from 'xlsx';

interface DashboardProps {
  inspections: InspectionRecord[];
  onUpdateInspections: (inspections: InspectionRecord[]) => void;
  onScan: () => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
  onReportGenerated?: (report: ReportHistory) => void;
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
  qrCodes = [],
  reports = []
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const handleExcelImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
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

        onUpdateInspections(updatedInspections);
        
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

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
      {/* Left Panel: Stats & List */}
      <div className={`
        ${selectedId ? 'hidden lg:flex' : 'flex'} 
        lg:col-span-4 flex-col gap-6 h-full
      `}>
        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (isExporting) return; // 중복 클릭 방지
              
              setIsExporting(true);
              try {
                // 현재 선택된 inspection의 최신 formData가 있으면 반영
                let inspectionsToExport = [...inspections];
                if (selectedId && currentFormData && currentFormData.panelNo === selectedId) {
                  // 현재 편집 중인 formData로 업데이트
                  inspectionsToExport = inspectionsToExport.map(inspection =>
                    inspection.panelNo === selectedId ? currentFormData : inspection
                  );
                }

                // 엑셀 내보내기 실행
                const exportedPanelNos = await exportToExcel(inspectionsToExport, qrCodes, reports);
                
                // 내보내기 완료 후 로컬 사진 삭제 (옵션 A: 사진만 삭제)
                const updatedInspections = deleteLocalPhotosAfterExport(exportedPanelNos, inspectionsToExport);
                onUpdateInspections(updatedInspections);
                
                alert(`엑셀 내보내기가 완료되었습니다.\n${exportedPanelNos.length}개의 분전반 데이터가 내보내졌으며, 로컬 사진은 삭제되었습니다.\n(사진은 엑셀 파일에만 보관됩니다.)`);
              } catch (error) {
                console.error('엑셀 내보내기 오류:', error);
                alert('엑셀 내보내기 중 오류가 발생했습니다.\n오류: ' + (error instanceof Error ? error.message : String(error)));
              } finally {
                setIsExporting(false);
              }
            }}
            disabled={isExporting}
            className={`flex-1 flex items-center justify-center gap-2 ${
              isExporting 
                ? 'bg-emerald-400 cursor-not-allowed' 
                : 'bg-emerald-600 hover:bg-emerald-700'
            } text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm`}
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>내보내는 중...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet size={18} />
                <span>엑셀 내보내기</span>
              </>
            )}
          </button>
          <label className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm cursor-pointer">
            <FileUp size={18} />
            엑셀 입력
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelImport}
              className="hidden"
            />
          </label>
        </div>

        {/* Stats Card */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Inspection Status</h3>
          <div className="flex items-center justify-between">
            <div className="w-1/2">
              <StatsChart data={stats} />
            </div>
            <div className="w-1/2 space-y-2">
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
        lg:col-span-8 h-full flex-col
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
