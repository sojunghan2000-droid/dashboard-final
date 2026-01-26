import React, { useState, useEffect } from 'react';
import { InspectionRecord } from './types';
import Dashboard from './components/Dashboard';
import DashboardOverview from './components/DashboardOverview';
import ReportsList from './components/ReportsList';
import QRGenerator from './components/QRGenerator';
import QRScanner from './components/QRScanner';
import { getSavedReports } from './services/reportService';
import { LayoutDashboard, ScanLine, Bell, Menu, ShieldCheck, ClipboardList, BarChart3, QrCode, X } from 'lucide-react';

const MOCK_DATA: InspectionRecord[] = [
  { id: 'DB-A-001', status: 'Complete', lastInspectionDate: '2024-05-20 09:30', loads: { welder: true, grinder: false, light: true, pump: false }, photoUrl: 'https://picsum.photos/400/300?random=1', memo: 'All connections secure.', position: { x: 25, y: 30 } },
  { id: 'DB-A-002', status: 'Complete', lastInspectionDate: '2024-05-20 10:15', loads: { welder: false, grinder: true, light: true, pump: false }, photoUrl: 'https://picsum.photos/400/300?random=2', memo: '', position: { x: 75, y: 25 } },
  { id: 'DB-A-003', status: 'In Progress', lastInspectionDate: '2024-05-21 08:00', loads: { welder: false, grinder: false, light: true, pump: true }, photoUrl: null, memo: 'Check ground fault interrupter.', position: { x: 50, y: 50 } },
  { id: 'DB-B-001', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '', position: { x: 15, y: 70 } },
  { id: 'DB-B-002', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '', position: { x: 85, y: 75 } },
  // 추가 검사 항목들 - 위치 정보 포함
  { id: 'DB-A-004', status: 'Complete', lastInspectionDate: '2024-05-22 14:20', loads: { welder: true, grinder: true, light: false, pump: false }, photoUrl: null, memo: 'Regular maintenance completed.', position: { x: 30, y: 60 } },
  { id: 'DB-A-005', status: 'In Progress', lastInspectionDate: '2024-05-23 11:00', loads: { welder: false, grinder: false, light: true, pump: true }, photoUrl: null, memo: 'Inspection in progress.', position: { x: 60, y: 40 } },
  { id: 'DB-B-003', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '', position: { x: 40, y: 20 } },
  { id: 'DB-A-006', status: 'Complete', lastInspectionDate: '2024-05-19 16:45', loads: { welder: true, grinder: false, light: true, pump: true }, photoUrl: null, memo: 'All systems operational.', position: { x: 70, y: 60 } },
  { id: 'DB-A-007', status: 'In Progress', lastInspectionDate: '2024-05-24 09:15', loads: { welder: false, grinder: true, light: false, pump: false }, photoUrl: null, memo: 'Pending review.', position: { x: 20, y: 45 } },
  { id: 'DB-A-008', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '', position: { x: 90, y: 50 } },
  { id: 'DB-A-009', status: 'Complete', lastInspectionDate: '2024-05-18 13:30', loads: { welder: false, grinder: false, light: true, pump: false }, photoUrl: null, memo: 'Lighting system checked.', position: { x: 35, y: 80 } },
  { id: 'DB-B-004', status: 'In Progress', lastInspectionDate: '2024-05-25 10:00', loads: { welder: true, grinder: true, light: true, pump: false }, photoUrl: null, memo: 'Multiple loads connected.', position: { x: 65, y: 15 } },
];

type Page = 'dashboard' | 'dashboard-overview' | 'reports' | 'qr-generator';

const STORAGE_KEY_INSPECTIONS = 'safetyguard_inspections';

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

// 층수 마이그레이션 함수: "1st" -> "F1"
const migrateFloorFormat = (data: any): any => {
  if (typeof data === 'string') {
    // ID 형식인지 확인 (DB-로 시작)
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
      if (key === 'id' && typeof data[key] === 'string') {
        // ID 마이그레이션
        migrated[key] = migrateIdFloor(data[key]);
      } else if (key === 'floor' && data[key] === '1st') {
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
        // Reports의 boardId도 마이그레이션
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
  const [inspections, setInspections] = useState<InspectionRecord[]>(() => {
    // localStorage에서 불러오기
    try {
      const saved = localStorage.getItem(STORAGE_KEY_INSPECTIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 층수 마이그레이션: "1st" -> "F1"
        const migrated = migrateFloorFormat(parsed);
        
        // position이 없는 항목들에 기본 위치 정보 추가
        const result = migrated.map((item: InspectionRecord) => {
          if (!item.position) {
            const randomX = Math.floor(Math.random() * 80) + 10;
            const randomY = Math.floor(Math.random() * 80) + 10;
            return { ...item, position: { x: randomX, y: randomY } };
          }
          return item;
        });
        
        // 마이그레이션된 데이터를 localStorage에 저장
        try {
          localStorage.setItem(STORAGE_KEY_INSPECTIONS, JSON.stringify(result));
        } catch (e) {
          console.error('Failed to save migrated inspections to localStorage:', e);
        }
        
        return result;
      }
    } catch (e) {
      console.error('Failed to load inspections from localStorage:', e);
    }
    
    // localStorage에 없으면 MOCK_DATA 사용
    const initialData = MOCK_DATA.map(item => {
      if (!item.position) {
        const randomX = Math.floor(Math.random() * 80) + 10;
        const randomY = Math.floor(Math.random() * 80) + 10;
        return { ...item, position: { x: randomX, y: randomY } };
      }
      return item;
    });
    
    // localStorage에 저장
    try {
      localStorage.setItem(STORAGE_KEY_INSPECTIONS, JSON.stringify(initialData));
    } catch (e) {
      console.error('Failed to save inspections to localStorage:', e);
    }
    
    return initialData;
  });
  const [currentPage, setCurrentPage] = useState<Page>('dashboard-overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showScanner, setShowScanner] = useState(false);
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [reports, setReports] = useState<any[]>([]);

  // inspections가 변경될 때마다 localStorage에 저장
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_INSPECTIONS, JSON.stringify(inspections));
    } catch (e) {
      console.error('Failed to save inspections to localStorage:', e);
    }
  }, [inspections]);

  // inspections가 업데이트될 때 position이 없는 항목들에 기본 위치 정보 추가
  useEffect(() => {
    setInspections(prev => {
      const updated = prev.map(item => {
        if (!item.position) {
          const randomX = Math.floor(Math.random() * 80) + 10;
          const randomY = Math.floor(Math.random() * 80) + 10;
          return { ...item, position: { x: randomX, y: randomY } };
        }
        return item;
      });
      return updated;
    });
  }, []);

  // Reports 로드 및 실시간 업데이트
  useEffect(() => {
    const loadReports = () => {
      const savedReports = getSavedReports();
      setReports(savedReports);
    };
    
    loadReports();
    
    // localStorage 변경 감지
    const handleStorageChange = () => {
      loadReports();
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    // 주기적으로 확인 (같은 탭에서의 변경 감지)
    const interval = setInterval(loadReports, 1000);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
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

  const handleQRScanSuccess = (qrData: string) => {
    try {
      // QR 코드 데이터 파싱
      let data: any;
      try {
        data = JSON.parse(qrData);
      } catch (parseError) {
        // JSON이 아닌 경우 직접 파싱 시도
        data = { raw: qrData };
      }
      
      // 스캔 시간 생성 (YYYY-MM-DD HH:mm 형식)
      const now = new Date();
      const scanTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // QR 코드에서 ID 찾기
      const qrId = data.id || (data.raw && data.raw.includes('DB-') ? data.raw.split('DB-')[1]?.split('-')[0] : null) || data.raw || 'UNKNOWN';
      
      // 저장된 QRCodeData에서 추가 정보 찾기
      const STORAGE_KEY_QR = 'safetyguard_qrcodes';
      const savedQRCodes: any[] = JSON.parse(localStorage.getItem(STORAGE_KEY_QR) || '[]');
      const matchedQR = savedQRCodes.find((qr: any) => {
        try {
          const qrDataObj = JSON.parse(qr.qrData || '{}');
          return qrDataObj.id === qrId || qr.id === qrId;
        } catch {
          return qr.id === qrId;
        }
      });

      // 기존 보드 찾기 (ID 기준)
      const existingBoard = inspections.find(i => i.id === qrId || i.id.includes(qrId));

      if (existingBoard) {
        // 기존 보드 업데이트 - QR 정보 반영
        const updatedBoard: InspectionRecord = {
          ...existingBoard,
          lastInspectionDate: scanTime, // QR 스캔 시간으로 자동 업데이트
          // QR 데이터에서 정보 가져오기 (우선순위: QR 데이터 > 기존 값)
          panelNo: data.panelNo || data.pnlNo || existingBoard.panelNo || (matchedQR ? `PNL NO. ${qrId}` : undefined),
          projectName: data.projectName || data.pjtName || data.pjt || existingBoard.projectName || '',
          contractor: data.contractor || data.시공사 || existingBoard.contractor || '',
          managementNumber: data.managementNumber || data.관리번호 || data.panelName || existingBoard.managementNumber || qrId,
        };
        
        setInspections(prev => prev.map(item => item.id === existingBoard.id ? updatedBoard : item));
        setCurrentPage('dashboard');
        setSelectedInspectionId(existingBoard.id);
        setShowScanner(false);
      } else {
        // 새 Distribution Board 생성
        const newId = data.id || `DB-${data.floor || 'F1'}-${data.location || 'LOC'}`;
        const newItem: InspectionRecord = {
          id: newId,
          status: 'In Progress',
          lastInspectionDate: scanTime, // QR 스캔 시간으로 설정
          loads: { welder: false, grinder: false, light: false, pump: false },
          photoUrl: null,
          memo: '',
          position: data.position ? (typeof data.position === 'object' ? data.position : { x: parseFloat(data.position) || 50, y: 50 }) : undefined,
          // QR 정보에서 기본 정보 가져오기
          panelNo: data.panelNo || data.pnlNo || `PNL NO. ${newId}`,
          projectName: data.projectName || data.pjtName || data.pjt || '',
          contractor: data.contractor || data.시공사 || '',
          managementNumber: data.managementNumber || data.관리번호 || data.panelName || newId,
        };
        setInspections(prev => [newItem, ...prev]);
        setCurrentPage('dashboard');
        setSelectedInspectionId(newId);
        setShowScanner(false);
      }
    } catch (error) {
      console.error('QR 데이터 처리 오류:', error);
      alert(`QR 코드 스캔 완료!\n데이터: ${qrData}`);
      setShowScanner(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden font-sans">
      
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-slate-900 text-white transition-all duration-300 flex flex-col overflow-hidden shadow-xl z-20`}>
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div 
            className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shrink-0 cursor-pointer hover:bg-blue-600 transition-colors"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          >
            <ShieldCheck size={20} className="text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight whitespace-nowrap">SafetyGuard<span className="text-blue-400">Pro</span></h1>
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
            QR Generator
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
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
              <Menu size={20} />
            </button>
            <h2 className="text-lg font-semibold text-slate-800">Distribution Board Manager</h2>
          </div>
          <div className="flex items-center gap-4">
             <button 
              onClick={() => setShowScanner(true)}
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
                                Board ID: {report.boardId}
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
        <main className="flex-1 overflow-y-auto p-6 relative">
          {currentPage === 'dashboard-overview' ? (
            <DashboardOverview 
              inspections={inspections} 
              onUpdateInspections={setInspections}
              selectedInspectionId={selectedInspectionId}
              onSelectionChange={setSelectedInspectionId}
            />
          ) : currentPage === 'dashboard' ? (
            <Dashboard 
              inspections={inspections}
              onUpdateInspections={setInspections}
              onScan={() => setShowScanner(true)}
              selectedInspectionId={selectedInspectionId}
              onSelectionChange={setSelectedInspectionId}
            />
          ) : currentPage === 'reports' ? (
            <ReportsList />
          ) : (
            <QRGenerator 
              inspections={inspections}
              onSelectInspection={(inspectionId) => {
                setSelectedInspectionId(inspectionId);
                setCurrentPage('dashboard-overview');
              }}
              onUpdateInspections={setInspections}
            />
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
      </div>
    </div>
  );
};

export default App;