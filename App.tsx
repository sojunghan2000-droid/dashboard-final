import React, { useState, useMemo } from 'react';
import { InspectionRecord, StatData } from './types';
import BoardList from './components/BoardList';
import InspectionDetail from './components/InspectionDetail';
import StatsChart from './components/StatsChart';
import { LayoutDashboard, ScanLine, Search, Bell, Menu, ShieldCheck, ClipboardList } from 'lucide-react';
import { generateReport } from './services/reportService';

const MOCK_DATA: InspectionRecord[] = [
  { id: 'DB-A-001', status: 'Complete', lastInspectionDate: '2024-05-20 09:30', loads: { welder: true, grinder: false, light: true, pump: false }, photoUrl: 'https://picsum.photos/400/300?random=1', memo: 'All connections secure.' },
  { id: 'DB-A-002', status: 'Complete', lastInspectionDate: '2024-05-20 10:15', loads: { welder: false, grinder: true, light: true, pump: false }, photoUrl: 'https://picsum.photos/400/300?random=2', memo: '' },
  { id: 'DB-A-003', status: 'In Progress', lastInspectionDate: '2024-05-21 08:00', loads: { welder: false, grinder: false, light: true, pump: true }, photoUrl: null, memo: 'Check ground fault interrupter.' },
  { id: 'DB-B-001', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '' },
  { id: 'DB-B-002', status: 'Pending', lastInspectionDate: '-', loads: { welder: false, grinder: false, light: false, pump: false }, photoUrl: null, memo: '' },
];

const App: React.FC = () => {
  const [inspections, setInspections] = useState<InspectionRecord[]>(MOCK_DATA);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showScanner, setShowScanner] = useState(false);

  // Derived state
  const selectedRecord = useMemo(() => 
    inspections.find(i => i.id === selectedId) || null, 
  [inspections, selectedId]);

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

  // Handlers
  const handleSave = (updated: InspectionRecord) => {
    // Update inspection record
    const finalRecord = {
      ...updated,
      lastInspectionDate: updated.status === 'Complete' 
        ? new Date().toLocaleString() 
        : updated.lastInspectionDate
    };
    
    setInspections(prev => prev.map(item => item.id === finalRecord.id ? finalRecord : item));
    
    // Generate and download report
    generateReport(finalRecord);
    
    // Show success message
    setTimeout(() => {
      alert("Report generated and saved successfully!");
    }, 500);
  };

  const handleScan = () => {
    // Simulate scanning a random pending or new item
    const pending = inspections.find(i => i.status === 'Pending');
    if (pending) {
      setSelectedId(pending.id);
    } else {
      const newId = `DB-C-00${Math.floor(Math.random() * 9) + 1}`;
      const newItem: InspectionRecord = {
        id: newId,
        status: 'In Progress',
        lastInspectionDate: new Date().toLocaleString(),
        loads: { welder: false, grinder: false, light: false, pump: false },
        photoUrl: null,
        memo: 'New scan initiated via Mobile App simulation.'
      };
      setInspections(prev => [newItem, ...prev]);
      setSelectedId(newId);
    }
    setShowScanner(false);
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden font-sans">
      
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-slate-900 text-white transition-all duration-300 flex flex-col overflow-hidden shadow-xl z-20`}>
        <div className="p-6 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shrink-0">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight whitespace-nowrap">SafetyGuard<span className="text-blue-400">Pro</span></h1>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-1">
          <div className="px-3 py-2 bg-slate-800 rounded-lg text-white font-medium flex items-center gap-3 cursor-pointer">
            <LayoutDashboard size={20} />
            Dashboard
          </div>
          <div className="px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg font-medium flex items-center gap-3 cursor-pointer transition-colors">
            <ClipboardList size={20} className="opacity-70"/>
            Reports
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

        {/* Dashboard Content */}
        <main className="flex-1 overflow-hidden p-6 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
            
            {/* Left Panel: Stats & List */}
            <div className={`
              ${selectedId ? 'hidden lg:flex' : 'flex'} 
              lg:col-span-4 flex-col gap-6 h-full
            `}>
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
                  onSelect={setSelectedId} 
                />
              </div>
            </div>

            {/* Right Panel: Detail View */}
            <div className={`
              ${selectedId ? 'flex' : 'hidden lg:flex'} 
              lg:col-span-8 h-full flex-col
            `}>
              {selectedRecord ? (
                <InspectionDetail 
                  record={selectedRecord} 
                  onSave={handleSave}
                  onCancel={() => setSelectedId(null)}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 text-slate-400">
                  <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                    <Search size={32} className="text-slate-400" />
                  </div>
                  <p className="font-medium">Select a Distribution Board to view details</p>
                  <p className="text-sm mt-2">Or scan a new QR code</p>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* Floating Action Button (Mobile Scan) */}
        <button 
          onClick={() => setShowScanner(true)}
          className="md:hidden absolute bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center z-50 hover:scale-105 transition-transform"
        >
          <ScanLine size={24} />
        </button>

        {/* Scanner Simulation Modal */}
        {showScanner && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
             <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in-up">
               <div className="bg-slate-900 p-6 flex justify-between items-start text-white">
                 <div>
                   <h3 className="text-xl font-bold">QR Scanner</h3>
                   <p className="text-slate-400 text-sm mt-1">Point device at distribution board</p>
                 </div>
                 <button onClick={() => setShowScanner(false)} className="text-slate-400 hover:text-white">
                   <span className="text-2xl">&times;</span>
                 </button>
               </div>
               <div className="h-64 bg-black relative flex items-center justify-center group cursor-pointer" onClick={handleScan}>
                 {/* Simulated Camera View */}
                 <div className="absolute inset-0 opacity-40 bg-[url('https://images.unsplash.com/photo-1541888946425-d81bb19240f5?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center"></div>
                 <div className="w-48 h-48 border-2 border-blue-500 rounded-lg relative z-10 flex items-center justify-center">
                   <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-blue-500 -mt-1 -ml-1"></div>
                   <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-blue-500 -mt-1 -mr-1"></div>
                   <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-blue-500 -mb-1 -ml-1"></div>
                   <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-blue-500 -mb-1 -mr-1"></div>
                   <div className="w-full h-0.5 bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div>
                 </div>
                 <div className="absolute bottom-4 bg-black/60 px-4 py-2 rounded-full text-white text-sm font-medium backdrop-blur-md">
                   Tap to Capture
                 </div>
               </div>
               <div className="p-4 bg-slate-50 text-center text-xs text-slate-500">
                 Simulating Power Apps QR Scan Functionality
               </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;