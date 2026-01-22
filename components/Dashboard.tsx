import React, { useState, useMemo } from 'react';
import { InspectionRecord, StatData } from '../types';
import BoardList from './BoardList';
import InspectionDetail from './InspectionDetail';
import StatsChart from './StatsChart';
import { ScanLine, Search } from 'lucide-react';
import { generateReport } from '../services/reportService';

interface DashboardProps {
  inspections: InspectionRecord[];
  onUpdateInspections: (inspections: InspectionRecord[]) => void;
  onScan: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ inspections, onUpdateInspections, onScan }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const handleSave = (updated: InspectionRecord) => {
    const finalRecord = {
      ...updated,
      lastInspectionDate: updated.status === 'Complete' 
        ? new Date().toLocaleString() 
        : updated.lastInspectionDate
    };
    
    const updatedInspections = inspections.map(item => 
      item.id === finalRecord.id ? finalRecord : item
    );
    onUpdateInspections(updatedInspections);
    
    // Generate and download report
    generateReport(finalRecord);
    
    // Show success message
    setTimeout(() => {
      alert("Report generated and saved successfully!");
    }, 500);
  };

  return (
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
  );
};

export default Dashboard;
