import React, { useMemo } from 'react';
import { InspectionRecord, StatData } from '../types';
import StatsChart from './StatsChart';
import FloorPlanView from './FloorPlanView';
import { CheckCircle2, Clock, AlertCircle, TrendingUp, Activity, ShieldCheck } from 'lucide-react';

interface DashboardOverviewProps {
  inspections: InspectionRecord[];
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({ 
  inspections, 
  onUpdateInspections,
  selectedInspectionId,
  onSelectionChange
}) => {
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

  const totalInspections = inspections.length;
  const completeCount = inspections.filter(i => i.status === 'Complete').length;
  const inProgressCount = inspections.filter(i => i.status === 'In Progress').length;
  const pendingCount = inspections.filter(i => i.status === 'Pending').length;
  const completionRate = totalInspections > 0 ? Math.round((completeCount / totalInspections) * 100) : 0;

  const recentInspections = useMemo(() => {
    return inspections
      .filter(i => i.status === 'Complete' || i.status === 'In Progress')
      .sort((a, b) => {
        const dateA = a.lastInspectionDate === '-' ? 0 : new Date(a.lastInspectionDate).getTime();
        const dateB = b.lastInspectionDate === '-' ? 0 : new Date(b.lastInspectionDate).getTime();
        return dateB - dateA;
      })
      .slice(0, 5);
  }, [inspections]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete':
        return <CheckCircle2 size={16} className="text-emerald-600" />;
      case 'In Progress':
        return <Clock size={16} className="text-blue-600" />;
      default:
        return <AlertCircle size={16} className="text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Complete':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'In Progress':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Dashboard Overview</h1>
          <p className="text-slate-600">Safety inspection status and statistics</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Activity size={24} className="text-blue-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{totalInspections}</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">Total Inspections</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <CheckCircle2 size={24} className="text-emerald-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{completeCount}</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">Completed</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-amber-100 rounded-lg">
                <Clock size={24} className="text-amber-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{inProgressCount}</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">In Progress</p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-purple-100 rounded-lg">
                <TrendingUp size={24} className="text-purple-600" />
              </div>
              <span className="text-2xl font-bold text-slate-800">{completionRate}%</span>
            </div>
            <p className="text-sm text-slate-600 font-medium">Completion Rate</p>
          </div>
        </div>

        {/* Charts and Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Chart */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Inspection Status</h3>
            <div className="flex items-center justify-center">
              <div className="w-48 h-48">
                <StatsChart data={stats} />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {stats.map(s => (
                <div key={s.name} className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }}></span>
                    <span className="text-slate-600 font-medium">{s.name}</span>
                  </div>
                  <span className="font-bold text-slate-800">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Inspections */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Inspections</h3>
            {recentInspections.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <ShieldCheck size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recent inspections</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentInspections.map((inspection) => (
                  <div
                    key={inspection.panelNo}
                    className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(inspection.status)}
                      <div>
                        <p className="font-medium text-slate-800">{inspection.panelNo}</p>
                        <p className="text-xs text-slate-500">
                          {inspection.lastInspectionDate !== '-' 
                            ? new Date(inspection.lastInspectionDate).toLocaleDateString()
                            : 'Not inspected'}
                        </p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(inspection.status)}`}>
                      {inspection.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Floor Plan View */}
        <FloorPlanView 
          inspections={inspections} 
          onUpdateInspections={onUpdateInspections}
          selectedInspectionId={selectedInspectionId}
          onSelectionChange={onSelectionChange}
        />

        {/* Pending Inspections Alert */}
        {pendingCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-amber-100 rounded-lg">
                <AlertCircle size={24} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 mb-1">Pending Inspections</h3>
                <p className="text-sm text-amber-700">
                  {pendingCount} distribution board{pendingCount > 1 ? 's' : ''} require inspection.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardOverview;
