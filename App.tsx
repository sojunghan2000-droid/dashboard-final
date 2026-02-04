//의미없는 주석

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { InspectionRecord, QRCodeData, ReportHistory } from './types';
import Dashboard from './components/Dashboard';
import DashboardOverview from './components/DashboardOverview';
import ReportsList from './components/ReportsList';
import QRGenerator from './components/QRGenerator';
import QRScanner from './components/QRScanner';
import ErrorBoundary from './components/ErrorBoundary';
import { LayoutDashboard, ScanLine, Bell, Menu, ShieldCheck, ClipboardList, BarChart3, QrCode, X, FileSpreadsheet, FileUp } from 'lucide-react';
import { initIndexedDB, getAllInspectionsWithPhotos, saveInspection, savePhoto, dataURLToBlob, getAllQRCodes, saveAllQRCodes } from './services/indexedDBService';
import { exportToExcel } from './services/excelService';
import ExportReviewModal from './components/ExportReviewModal';
import * as XLSX from 'xlsx';

/** 성수동 K-PJT 현장 가설용 가설 분전반 계통 ('25.12.30 기준, 총 65면)
 * TR-1 (A) 900KVA → floor='F1', TR-2 (B) 950KVA → floor='B1' */
const DL = { welder: false, grinder: false, light: false, pump: false }; // 기본 loads
const P = (pno: string, tr: 'A'|'B', sq: string, parent?: string, notes?: string): InspectionRecord => ({
  panelNo: pno, status: 'Pending', lastInspectionDate: '-', loads: { ...DL }, photoUrl: null, memo: '',
  tr, floor: tr === 'A' ? 'F1' : 'B1', nominalCrossSection: sq,
  ...(parent ? { parentPanelNo: parent } : {}), ...(notes ? { notes } : {}),
});
const MOCK_DATA: InspectionRecord[] = [
  // === TR-1 (A) 900KVA — F1 ===
  P('1','A','95SQ'), P('1-1','A','95SQ','1'), P('1-2','A','50SQ','1'), P('1-2-1','A','50SQ','1-2'),
  P('2','A','95SQ'),
  P('3','A','95SQ'), P('3-1','A','50SQ','3'), P('3-1-1','A','16SQ','3-1'), P('3-1-2','A','35SQ','3-1'),
  P('3-1충전부','A','95SQ','3-1','충전부'), P('3-1충전부-1','A','50SQ','3-1충전부','충전부'),
  P('3-2','A','50SQ','3','양수기'),
  P('4','A','95SQ'), P('4-1','A','35SQ','4'),
  P('5','A','95SQ'), P('5-1','A','35SQ','5'), P('5-2','A','95SQ','5'),
  P('5-2-1','A','50SQ','5-2','전력량계'), P('5-2-2','A','50SQ','5-2','전력량계'), P('5-2-2-1','A','50SQ','5-2-2'),
  P('7','A','150SQ',undefined,'T/C1(L)'), P('7-1','A','95SQ','7'), P('7-1-1','A','16SQ','7-1'),
  P('7-2','A','95SQ','7'), P('7-2-1','A','16SQ','7-2'), P('7-3','A','95SQ','7'), P('7-4','A','95SQ','7'),
  P('8','A','300SQ',undefined,'T/C4'), P('9','A','300SQ',undefined,'T/C1'),
  P('16','A','95SQ'), P('16-1','A','95SQ','16'), P('16-2','A','95SQ','16'),
  // === TR-2 (B) 950KVA — B1 ===
  P('6','B','300SQ'), P('6-1','B','150SQ','6'), P('6-1-1','B','95SQ','6-1'), P('6-1-2','B','95SQ','6-1'),
  P('6-1-2-1','B','150SQ','6-1-2'), P('6-1-3','B','95SQ','6-1'), P('6-1-3-1','B','95SQ','6-1-3','양수기'),
  P('6-2','B','150SQ','6'), P('6-2-1','B','95SQ','6-2'), P('6-2-2','B','95SQ','6-2'),
  P('6-2-2-1','B','95SQ','6-2-2','T/C4(L)'), P('6-2-2-2','B','16SQ','6-2-2'),
  P('6-2-3','B','95SQ','6-2'), P('6-2-3-1','B','95SQ','6-2-3'),
  P('10','B','300SQ',undefined,'T/C2'), P('11','B','150SQ',undefined,'T/C2(L)'),
  P('11-1','B','95SQ','11'), P('11-1-1','B','16SQ','11-1'), P('11-1-2','B','95SQ','11-1'),
  P('11-2','B','95SQ','11'), P('11-3','B','95SQ','11'),
  P('12','B','185SQ',undefined,'T/C3(L)'), P('12-1','B','95SQ','12'), P('12-1-1','B','16SQ','12-1'),
  P('12-2','B','95SQ','12'), P('12-3','B','95SQ','12'),
  P('13','B','150SQ'), P('13-1','B','95SQ','13'),
  P('14','B','300SQ',undefined,'T/C3'),
  P('15','B','150SQ'), P('15-1','B','50SQ','15'), P('15-2','B','50SQ','15'),
];

type Page = 'dashboard' | 'dashboard-overview' | 'reports' | 'qr-generator';

// 유틸리티 함수: 날짜 포맷팅 (YYYY-MM-DD hh:mm:ss)
const formatDateTime = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// 유틸리티 함수: position이 없는 항목에 기본 위치 추가
const ensurePosition = (item: InspectionRecord): InspectionRecord => {
  if (!item.position) {
    const randomX = Math.floor(Math.random() * 80) + 10;
    const randomY = Math.floor(Math.random() * 80) + 10;
    return { ...item, position: { x: randomX, y: randomY } };
  }
  return item;
};

// ID에서 "1st"를 "F1"으로 변경하는 함수
const migrateIdFloor = (id: string): string => {
  if (id && typeof id === 'string') {
    // DB-1st-001 -> DB-F1-001 형식으로 변경
    // 모든 경우를 처리: DB-1st-001, DB-1st-002 등
    if (id.includes('-1st-')) {
      return id.replace(/-1st-/g, '-F1-');
    }
    // DB-1st-로 시작하는 경우도 처리
    if (id.startsWith('DB-1st-')) {
      return id.replace(/^DB-1st-/, 'DB-F1-');
    }
  }
  return id;
};

// id → panelNo 마이그레이션: 기존 저장 데이터를 새 구조로 변환
const migrateRecordToPanelNo = (item: any): InspectionRecord => {
  const panelNo = (item.panelNo ?? item.id ?? '').toString();
  const { id, ...rest } = item;
  return { ...rest, panelNo: panelNo || 'UNKNOWN' } as InspectionRecord;
};

// 층수 마이그레이션 함수: "1st" -> "F1"
const migrateFloorFormat = (data: any): any => {
  if (typeof data === 'string') {
    if (data.startsWith('DB-')) {
      return migrateIdFloor(data);
    }
    return data === '1st' ? 'F1' : data;
  }
  if (Array.isArray(data)) {
    return data.map(item => migrateFloorFormat(item));
  }
  if (data && typeof data === 'object') {
    const migrated: any = {};
    for (const key in data) {
      if (key === 'floor' && data[key] === '1st') {
        migrated[key] = 'F1';
      } else if (key === 'qrData' && typeof data[key] === 'string') {
        try {
          const qrData = JSON.parse(data[key]);
          if (qrData.id) {
            qrData.id = migrateIdFloor(qrData.id);
          }
          if (qrData.floor === '1st') {
            qrData.floor = 'F1';
          }
          migrated[key] = JSON.stringify(qrData);
        } catch {
          migrated[key] = data[key];
        }
      } else if (key === 'boardId' && typeof data[key] === 'string') {
        migrated[key] = migrateIdFloor(data[key]);
      } else {
        migrated[key] = migrateFloorFormat(data[key]);
      }
    }
    return migrated;
  }
  return data;
};

const App: React.FC = () => {
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [qrCodes, setQrCodesState] = useState<QRCodeData[]>([]);

  // QR Codes 변경 시 IndexedDB에도 저장
  const setQrCodes = useCallback(async (newQrCodes: QRCodeData[] | ((prev: QRCodeData[]) => QRCodeData[])) => {
    setQrCodesState(prev => {
      const updatedQrCodes = typeof newQrCodes === 'function' ? newQrCodes(prev) : newQrCodes;
      // 비동기로 IndexedDB에 저장
      saveAllQRCodes(updatedQrCodes).catch(error => {
        console.error('QR Codes IndexedDB 저장 오류:', error);
      });
      return updatedQrCodes;
    });
  }, []);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard-overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [reports, setReports] = useState<ReportHistory[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showExportPreview, setShowExportPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // IndexedDB 초기화 및 데이터 로드
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        await initIndexedDB();

        // Inspections 로드: IndexedDB + MOCK_DATA 머지 (새 패널 자동 추가)
        const loadedInspections = await getAllInspectionsWithPhotos();
        const existingPanelNos = new Set(loadedInspections.map(i => i.panelNo));
        const newFromMock = MOCK_DATA.filter(m => !existingPanelNos.has(m.panelNo));
        const merged = [...loadedInspections, ...newFromMock];
        setInspections(merged.map(item => ensurePosition(item)));

        // QR Codes 로드 (초기 로드이므로 IndexedDB 저장 없이 직접 state 설정)
        const loadedQRCodes = await getAllQRCodes();
        if (loadedQRCodes.length > 0) {
          setQrCodesState(loadedQRCodes);
        }
      } catch (error) {
        console.error('IndexedDB 로드 오류:', error);
        // 오류 발생 시 MOCK_DATA 사용
        setInspections(MOCK_DATA.map(item => ensurePosition(item)));
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  /**
   * inspections 업데이트 함수: panelNo 기준 중복 제거 + IndexedDB 저장
   * PNL NO당 저장 데이터는 항상 1개만 유지 (덮어쓰기 정책)
   * 같은 panelNo가 여러 개 있으면 마지막 항목만 유지
   */
  const updateInspections = useCallback(async (newInspections: InspectionRecord[]) => {
    // panelNo 기준으로 중복 제거: 같은 panelNo가 여러 개 있으면 마지막 항목만 유지
    const seen = new Set<string>();
    const uniqueInspections: InspectionRecord[] = [];
    
    // 역순으로 순회하여 마지막 항목만 유지
    for (let i = newInspections.length - 1; i >= 0; i--) {
      const inspection = newInspections[i];
      if (!seen.has(inspection.panelNo)) {
        seen.add(inspection.panelNo);
        uniqueInspections.unshift(inspection);
      }
    }
    
    setInspections(uniqueInspections);

    // IndexedDB에 저장
    try {
      await Promise.all(
        uniqueInspections.map(async (inspection) => {
          // Inspection 데이터 저장
          await saveInspection(inspection);

          // 사진이 있으면 Blob으로 변환하여 저장 (현장사진 또는 열화상 중 하나라도 있으면 저장)
          const hasPhotoUrl = inspection.photoUrl?.startsWith?.('data:image');
          const hasThermalUrl = inspection.thermalImage?.imageUrl?.startsWith?.('data:image');

          if (hasPhotoUrl || hasThermalUrl) {
            try {
              let photoBlob: Blob | null = null;
              let thermalImageBlob: Blob | null = null;

              if (hasPhotoUrl) {
                photoBlob = dataURLToBlob(inspection.photoUrl!);
              } else if (inspection.photoUrl && !inspection.photoUrl.startsWith('data:image')) {
                console.warn(`PNL NO ${inspection.panelNo}: photoUrl이 Data URL 형식이 아닙니다. 저장하지 않습니다.`);
              }

              if (hasThermalUrl) {
                thermalImageBlob = dataURLToBlob(inspection.thermalImage!.imageUrl!);
              } else if (inspection.thermalImage?.imageUrl && !inspection.thermalImage.imageUrl.startsWith('data:image')) {
                console.warn(`PNL NO ${inspection.panelNo}: thermalImage.imageUrl이 Data URL 형식이 아닙니다. 저장하지 않습니다.`);
              }

              await savePhoto(inspection.panelNo, photoBlob, thermalImageBlob);
            } catch (error) {
              console.error(`PNL NO ${inspection.panelNo} 사진 저장 오류:`, error);
              try {
                await savePhoto(inspection.panelNo, null, null);
              } catch (saveError) {
                console.error(`PNL NO ${inspection.panelNo} 사진 삭제 오류:`, saveError);
              }
            }
          } else {
            // 사진이 없으면 null로 저장 (덮어쓰기)
            await savePhoto(inspection.panelNo, null, null);
          }
        })
      );
    } catch (error) {
      console.error('IndexedDB 저장 오류:', error);
    }
  }, []);

  // 알림 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showNotifications && !target.closest('.notification-dropdown')) {
        setShowNotifications(false);
      }
    };

    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  const handleQRScanSuccess = useCallback((qrData: string) => {
    try {
      // QR 코드 데이터 파싱
      let data: any;
      try {
        data = JSON.parse(qrData);
      } catch (parseError) {
        // JSON이 아닌 경우 직접 파싱 시도
        data = { raw: qrData };
      }
      
      // 스캔 시간 생성 (YYYY-MM-DD hh:mm:ss 형식)
      const scanTime = formatDateTime();

      // QR 코드에서 PNL NO. 찾기 (id 또는 panelNo)
      const qrPanelNo = data.panelNo || data.pnlNo || data.id || (data.raw && data.raw.includes('DB-') ? data.raw : null) || data.raw || 'UNKNOWN';

      const matchedQR = qrCodes.find((qr: any) => {
        try {
          const qrDataObj = JSON.parse(qr.qrData || '{}');
          return qrDataObj.id === qrPanelNo || qrDataObj.panelNo === qrPanelNo || qr.id === qrPanelNo;
        } catch {
          return qr.id === qrPanelNo;
        }
      });

      // 기존 보드 찾기 (panelNo 기준)
      const existingBoard = inspections.find(i => i.panelNo === qrPanelNo || i.panelNo.includes(qrPanelNo));

      if (existingBoard) {
        const updatedBoard: InspectionRecord = {
          ...existingBoard,
          lastInspectionDate: scanTime,
          panelNo: data.panelNo || data.pnlNo || existingBoard.panelNo || (matchedQR ? `PNL NO. ${qrPanelNo}` : existingBoard.panelNo),
          projectName: data.projectName || data.pjtName || data.pjt || existingBoard.projectName || '',
          contractor: data.contractor || data.시공사 || existingBoard.contractor || '',
          managementNumber: data.managementNumber || data.관리번호 || data.panelName || existingBoard.managementNumber || qrPanelNo,
        };
        setInspections(prev => prev.map(item => item.panelNo === existingBoard.panelNo ? updatedBoard : item));
        setCurrentPage('dashboard');
        setSelectedInspectionId(existingBoard.panelNo);
        setShowScanner(false);
      } else {
        const newPanelNo = data.panelNo || data.pnlNo || data.id || `DB-${data.floor || 'F1'}-${data.location || 'LOC'}`;
        const newItem: InspectionRecord = {
          panelNo: newPanelNo,
          status: 'In Progress',
          lastInspectionDate: scanTime,
          loads: { welder: false, grinder: false, light: false, pump: false },
          photoUrl: null,
          memo: '',
          position: data.position ? (typeof data.position === 'object' ? data.position : { x: parseFloat(data.position) || 50, y: 50 }) : undefined,
          projectName: data.projectName || data.pjtName || data.pjt || '',
          contractor: data.contractor || data.시공사 || '',
          managementNumber: data.managementNumber || data.관리번호 || data.panelName || newPanelNo,
        };
        setInspections(prev => [newItem, ...prev]);
        setCurrentPage('dashboard');
        setSelectedInspectionId(newPanelNo);
        setShowScanner(false);
      }
    } catch (error) {
      console.error('QR 데이터 처리 오류:', error);
      alert(`QR 코드 스캔 완료!\n데이터: ${qrData}`);
      setShowScanner(false);
    }
  }, [inspections, qrCodes]);

  const handleScanButtonClick = useCallback(() => {
    // QR 스캔 버튼 클릭 순간의 시간 생성
    const scanTime = formatDateTime();
    
    if (selectedInspectionId) {
      setInspections(prev => prev.map(item =>
        item.panelNo === selectedInspectionId
          ? { ...item, lastInspectionDate: scanTime }
          : item
      ));
    }
    
    setShowScanner(true);
  }, [selectedInspectionId, setInspections, setShowScanner]);

  return (
    <div className="flex h-screen min-h-[100dvh] bg-slate-50 text-slate-800 overflow-hidden font-sans">
      
      {/* 모바일: 사이드바 열릴 때 배경 클릭 시 닫기 */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      
      {/* Sidebar - 모바일: 오버레이, 데스크톱: 인라인 */}
      <aside className={`
        ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-0 md:translate-x-0'}
        ${isSidebarOpen ? 'md:w-64' : 'md:w-0'}
        fixed md:relative inset-y-0 left-0 z-50 md:z-20
        bg-slate-900 text-white transition-all duration-300 flex flex-col overflow-hidden shadow-xl
      `}>
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div 
            className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shrink-0 cursor-pointer hover:bg-blue-600 transition-colors"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            <ShieldCheck size={20} className="text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight whitespace-nowrap">성수동 <span className="text-blue-400">K-PJT</span></h1>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1">
          <div 
            onClick={() => setCurrentPage('dashboard-overview')}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'dashboard-overview' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BarChart3 size={20} />
            Dashboard
          </div>
          <div 
            onClick={() => setCurrentPage('dashboard')}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'dashboard' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <LayoutDashboard size={20} />
            Inspection
          </div>
          <div 
            onClick={() => setCurrentPage('reports')}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'reports' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ClipboardList size={20} className={currentPage === 'reports' ? '' : 'opacity-70'}/>
            Reports
          </div>
          <div 
            onClick={() => setCurrentPage('qr-generator')}
            className={`px-3 py-2 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors ${
              currentPage === 'qr-generator' 
                ? 'bg-slate-800 text-white' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <QrCode size={20} className={currentPage === 'qr-generator' ? '' : 'opacity-70'}/>
            Panel Master
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500"></div>
            <div>
              <p className="text-sm font-medium">Admin User</p>
              <p className="text-xs text-slate-500">Facility Manager</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-0 h-screen overflow-hidden relative">
        
        {/* Topbar */}
        <header className="h-16 min-h-[44px] shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shadow-sm z-10">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center">
              <Menu size={20} />
            </button>
            <h2 className="text-sm md:text-lg font-semibold text-slate-800 truncate">Distribution Board Manager</h2>
          </div>
          <div className="flex items-center gap-4">
            {/* 엑셀 내보내기 버튼 */}
            <button
              onClick={() => setShowExportPreview(true)}
              disabled={isExporting}
              className={`hidden md:flex items-center gap-2 ${
                isExporting 
                  ? 'bg-emerald-400 cursor-not-allowed' 
                  : 'bg-emerald-600 hover:bg-emerald-700'
              } text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm`}
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
            
            {/* 엑셀 입력 버튼 */}
            <label className="hidden md:flex bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium items-center gap-2 transition-colors shadow-sm cursor-pointer">
              <FileUp size={18} />
              {isImporting ? '로딩 중...' : '엑셀 입력'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  setIsImporting(true);
                  
                  try {
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      try {
                        const data = event.target?.result as ArrayBuffer;
                        if (!data) {
                          alert('파일을 읽을 수 없습니다.');
                          setIsImporting(false);
                          return;
                        }
                        
                        // Dashboard 페이지로 이동
                        setCurrentPage('dashboard');
                        
                        // Dashboard의 파일 입력을 트리거
                        setTimeout(() => {
                          const dashboardExcelInput = document.querySelector('[data-excel-import-button] input[type="file"]') as HTMLInputElement;
                          if (dashboardExcelInput) {
                            // 파일을 Dashboard의 input에 설정
                            const dataTransfer = new DataTransfer();
                            dataTransfer.items.add(new File([data], file.name));
                            dashboardExcelInput.files = dataTransfer.files;
                            dashboardExcelInput.dispatchEvent(new Event('change', { bubbles: true }));
                          }
                        }, 300);
                      } catch (error) {
                        console.error('엑셀 파일 읽기 오류:', error);
                        alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
                      } finally {
                        setIsImporting(false);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }
                    };
                    reader.onerror = () => {
                      alert('파일 읽기 중 오류가 발생했습니다.');
                      setIsImporting(false);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    };
                    reader.readAsArrayBuffer(file);
                  } catch (error) {
                    console.error('엑셀 파일 처리 오류:', error);
                    alert('엑셀 파일 처리 중 오류가 발생했습니다.');
                    setIsImporting(false);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }
                }}
                className="hidden"
                disabled={isImporting}
              />
            </label>
            
             <button 
              onClick={handleScanButtonClick}
              className="hidden md:flex bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium items-center gap-2 transition-colors shadow-sm"
            >
              <ScanLine size={18} />
              Simulate Mobile Scan
            </button>
            <div className="relative notification-dropdown">
              <Bell 
                size={20} 
                className="text-slate-500 cursor-pointer hover:text-slate-700" 
                onClick={() => setShowNotifications(!showNotifications)}
              />
              {reports.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
              )}
              
              {/* 알림 드롭다운 */}
              {showNotifications && (
                <div className="absolute right-0 top-10 w-80 bg-white rounded-lg shadow-xl border border-slate-200 z-50 max-h-96 overflow-y-auto notification-dropdown">
                  <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-800">알림</h3>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  
                  {reports.length === 0 ? (
                    <div className="p-6 text-center text-slate-500">
                      <p className="text-sm">알림이 없습니다</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {reports.slice(0, 10).map((report) => (
                        <div
                          key={report.id}
                          className="p-4 hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => {
                            setCurrentPage('reports');
                            setShowNotifications(false);
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800 mb-1">
                                {report.reportId}
                              </p>
                              <p className="text-xs text-slate-600 mb-1">
                                PNL NO.: {report.boardId}
                              </p>
                              <p className="text-xs text-slate-500">
                                {new Date(report.generatedAt).toLocaleString('ko-KR', {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              report.status === 'Complete' 
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : report.status === 'In Progress'
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-slate-50 text-slate-600 border border-slate-200'
                            }`}>
                              {report.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {reports.length > 10 && (
                    <div className="p-3 border-t border-slate-200 text-center">
                      <button
                        onClick={() => {
                          setCurrentPage('reports');
                          setShowNotifications(false);
                        }}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        모든 알림 보기 ({reports.length})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 md:p-6 relative">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
                <p className="text-slate-600">데이터를 불러오는 중...</p>
              </div>
            </div>
          ) : (
            <>
              {currentPage === 'dashboard-overview' ? (
                <DashboardOverview 
                  inspections={inspections} 
                  onUpdateInspections={updateInspections}
                  selectedInspectionId={selectedInspectionId}
                  onSelectionChange={setSelectedInspectionId}
                />
              ) : currentPage === 'dashboard' ? (
                <ErrorBoundary>
                  <Dashboard 
                    inspections={inspections}
                    onUpdateInspections={updateInspections}
                    onScan={() => setShowScanner(true)}
                    selectedInspectionId={selectedInspectionId}
                    onSelectionChange={setSelectedInspectionId}
                    onReportGenerated={(report) => setReports(prev => [report, ...prev])}
                    onReportsUpdate={(reports) => setReports(reports)}
                    qrCodes={qrCodes}
                    reports={reports}
                  />
                </ErrorBoundary>
              ) : currentPage === 'reports' ? (
                <ReportsList 
                  reports={reports}
                  onDeleteReport={(id) => setReports(prev => prev.filter(r => r.id !== id))}
                  inspections={inspections}
                />
              ) : (
                <QRGenerator 
                  inspections={inspections}
                  qrCodes={qrCodes}
                  onQrCodesChange={setQrCodes}
                  onSelectInspection={(inspectionId) => {
                    setSelectedInspectionId(inspectionId);
                  }}
                  onUpdateInspections={updateInspections}
                  mainScrollRef={mainScrollRef}
                />
              )}
            </>
          )}
        </main>

        {/* Floating Action Button (Mobile Scan) */}
        <button 
          onClick={() => setShowScanner(true)}
          className="md:hidden absolute bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center z-50 hover:scale-105 transition-transform"
        >
          <ScanLine size={24} />
        </button>

        {/* QR Scanner Modal */}
        {showScanner && (
          <QRScanner
            onScanSuccess={handleQRScanSuccess}
            onClose={() => setShowScanner(false)}
          />
        )}

        {/* 엑셀 내보내기 검토 모달 */}
        {showExportPreview && (
          <ExportReviewModal
            inspections={inspections}
            onConfirm={async () => {
              setIsExporting(true);
              try {
                await exportToExcel(inspections, qrCodes, reports);
                setShowExportPreview(false);
                alert(`엑셀 내보내기가 완료되었습니다.\n${inspections.length}개의 분전반 데이터가 내보내졌습니다.`);
              } catch (error) {
                console.error('엑셀 내보내기 오류:', error);
                alert('엑셀 내보내기 중 오류가 발생했습니다.\n오류: ' + (error instanceof Error ? error.message : String(error)));
              } finally {
                setIsExporting(false);
              }
            }}
            onCancel={() => setShowExportPreview(false)}
            isExporting={isExporting}
          />
        )}
      </div>
    </div>
  );
};

export default App;