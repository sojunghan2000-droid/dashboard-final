import React, { useState } from 'react';
import { InspectionRecord } from './types';
import Dashboard from './components/Dashboard';
import DashboardOverview from './components/DashboardOverview';
import ReportsList from './components/ReportsList';
import QRGenerator from './components/QRGenerator';
import QRScanner from './components/QRScanner';
import { LayoutDashboard, ScanLine, Bell, Menu, ShieldCheck, ClipboardList, BarChart3, QrCode } from 'lucide-react';

const MOCK_DATA: InspectionRecord[] = [
  { id: 'DB-A-001', status: 'Complete', lastInspectionDate: '2024-05-20 09:30', loads: { welder: true, grinder: false, light: true, pump: false }, photoUrl: 'https://picsum.photos/400/300?random=1', memo: 'All connections secure.', position: { x: 25, y: 30 } },
  { id: 'DB-A-002', status: 'Complete', lastInspectionDate: '2024-05-20 10:15', loads: { welder: false, grinder: true, light: true, pump: false }, photoUrl: 'https://picsum.photos/400/300?random=2', memo: '', position: { x: 75, y: 25 } },
  { id: 'DB-A-003', status: 'In Progress', lastInspectionDate: '2024-05-21 08:00', loads: { welder: false, grinder: false, light: true, pump: true }, photoUrl: null, memo: 'Check ground fault interrupter.', position: { x: 50, y: 50 } },
  { id: 'DB-B-001', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '', position: { x: 15, y: 70 } },
  { id: 'DB-B-002', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '', position: { x: 85, y: 75 } },
];

type Page = 'dashboard' | 'dashboard-overview' | 'reports' | 'qr-generator';

const App: React.FC = () => {
  const [inspections, setInspections] = useState<InspectionRecord[]>(MOCK_DATA);
  const [currentPage, setCurrentPage] = useState<Page>('dashboard-overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showScanner, setShowScanner] = useState(false);

  const handleQRScanSuccess = (qrData: string) => {
    try {
      // QR 코드 데이터 파싱
      const data = JSON.parse(qrData);
      
      // QR 코드에서 위치 정보를 가져와서 Distribution Board 찾기 또는 생성
      const existingBoard = inspections.find(i => 
        i.id.includes(data.location) || 
        (i.position && data.position && i.position.x.toString().includes(data.position))
      );

      if (existingBoard) {
        // 기존 보드 선택
        setCurrentPage('dashboard');
        // Dashboard에서 선택하도록 처리 필요
        setShowScanner(false);
        alert(`QR 코드 스캔 완료!\n위치: ${data.location}\n층수: ${data.floor}\n기존 Distribution Board를 찾았습니다.`);
      } else {
        // 새 Distribution Board 생성
        const newId = `DB-${data.location}-${data.floor}-${Date.now().toString().slice(-4)}`;
        const newItem: InspectionRecord = {
          id: newId,
          status: 'In Progress',
          lastInspectionDate: new Date().toLocaleString(),
          loads: { welder: false, grinder: false, light: false, pump: false },
          photoUrl: null,
          memo: `QR 스캔으로 생성됨\n위치: ${data.location}\n층수: ${data.floor}\n위치 정보: ${data.position}`,
          position: data.position ? { x: parseFloat(data.position) || 50, y: 50 } : undefined
        };
        setInspections(prev => [newItem, ...prev]);
        setCurrentPage('dashboard');
        setShowScanner(false);
        alert(`QR 코드 스캔 완료!\n새 Distribution Board가 생성되었습니다: ${newId}`);
      }
    } catch (error) {
      // JSON 파싱 실패 시 일반 텍스트로 처리
      console.error('QR 데이터 파싱 오류:', error);
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
            <div className="relative">
              <Bell size={20} className="text-slate-500 cursor-pointer hover:text-slate-700" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden p-6 relative">
          {currentPage === 'dashboard-overview' ? (
            <DashboardOverview inspections={inspections} />
          ) : currentPage === 'dashboard' ? (
            <Dashboard 
              inspections={inspections}
              onUpdateInspections={setInspections}
              onScan={() => setShowScanner(true)}
            />
          ) : currentPage === 'reports' ? (
            <ReportsList />
          ) : (
            <QRGenerator />
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