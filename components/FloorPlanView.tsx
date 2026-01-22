import React, { useState } from 'react';
import { InspectionRecord } from '../types';
import { CheckCircle2, Clock, AlertCircle, X } from 'lucide-react';

interface FloorPlanViewProps {
  inspections: InspectionRecord[];
  onSelectInspection?: (inspection: InspectionRecord) => void;
}

const FloorPlanView: React.FC<FloorPlanViewProps> = ({ inspections, onSelectInspection }) => {
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [hoveredInspection, setHoveredInspection] = useState<InspectionRecord | null>(null);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Complete':
        return '#10b981'; // emerald
      case 'In Progress':
        return '#3b82f6'; // blue
      case 'Pending':
        return '#94a3b8'; // slate
      default:
        return '#94a3b8';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete':
        return <CheckCircle2 size={16} className="text-white" />;
      case 'In Progress':
        return <Clock size={16} className="text-white" />;
      default:
        return <AlertCircle size={16} className="text-white" />;
    }
  };

  const handleMarkerClick = (inspection: InspectionRecord) => {
    setSelectedInspection(inspection);
    if (onSelectInspection) {
      onSelectInspection(inspection);
    }
  };

  const getConnectedLoadsCount = (loads: InspectionRecord['loads']) => {
    return Object.values(loads).filter(Boolean).length;
  };

  const getConnectedLoadsText = (loads: InspectionRecord['loads']) => {
    const connected = [];
    if (loads.welder) connected.push('Welder');
    if (loads.grinder) connected.push('Grinder');
    if (loads.light) connected.push('Light');
    if (loads.pump) connected.push('Pump');
    return connected.length > 0 ? connected.join(', ') : 'None';
  };

  // Filter inspections that have position data
  const positionedInspections = inspections.filter(inspection => inspection.position);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <h3 className="text-lg font-semibold text-slate-800">Distribution Board Locations</h3>
        <p className="text-sm text-slate-600 mt-1">
          {positionedInspections.length} board{positionedInspections.length !== 1 ? 's' : ''} mapped on floor plan
        </p>
      </div>

      <div className="relative bg-slate-100" style={{ minHeight: '600px' }}>
        {/* Floor Plan Image */}
        <div className="relative w-full h-full" style={{ minHeight: '600px' }}>
          <img
            src="/floor-plan.jpg"
            alt="Floor Plan"
            className="w-full h-auto object-contain"
            style={{ minHeight: '600px', objectFit: 'contain' }}
            onError={(e) => {
              // Try alternative formats if jpg fails
              const img = e.currentTarget as HTMLImageElement;
              if (img.src.endsWith('.jpg')) {
                img.src = '/floor-plan.png';
              } else if (img.src.endsWith('.png')) {
                img.src = '/floor-plan.jpeg';
              } else {
                // Fallback to placeholder if all formats fail
                img.src = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=800&fit=crop';
              }
            }}
          />

          {/* Markers */}
          {positionedInspections.map((inspection) => {
            const { x, y } = inspection.position!;
            const statusColor = getStatusColor(inspection.status);
            const isSelected = selectedInspection?.id === inspection.id;
            const isHovered = hoveredInspection?.id === inspection.id;

            return (
              <div
                key={inspection.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all z-10"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                }}
                onClick={() => handleMarkerClick(inspection)}
                onMouseEnter={() => setHoveredInspection(inspection)}
                onMouseLeave={() => setHoveredInspection(null)}
              >
                {/* Marker */}
                <div
                  className="relative"
                  style={{
                    transform: isSelected || isHovered ? 'scale(1.3)' : 'scale(1)',
                    transition: 'transform 0.2s',
                  }}
                >
                  {/* Pulse animation for active markers */}
                  {(isSelected || isHovered) && (
                    <div
                      className="absolute inset-0 rounded-full animate-ping opacity-75"
                      style={{
                        backgroundColor: statusColor,
                        width: '32px',
                        height: '32px',
                        marginLeft: '-16px',
                        marginTop: '-16px',
                      }}
                    />
                  )}

                  {/* Main marker circle */}
                  <div
                    className="relative rounded-full flex items-center justify-center shadow-lg border-2 border-white"
                    style={{
                      backgroundColor: statusColor,
                      width: '24px',
                      height: '24px',
                    }}
                  >
                    {getStatusIcon(inspection.status)}
                  </div>

                  {/* Tooltip on hover */}
                  {isHovered && !isSelected && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl whitespace-nowrap z-20">
                      <div className="font-semibold mb-1">{inspection.id}</div>
                      <div className="text-slate-300">{inspection.status}</div>
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
                        <div className="border-4 border-transparent border-t-slate-900"></div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Inspection Details Panel */}
        {selectedInspection && (
          <div className="absolute bottom-4 left-4 right-4 bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-30 max-w-md">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-bold text-slate-800 text-lg">{selectedInspection.id}</h4>
                <p className="text-sm text-slate-600">Distribution Board</p>
              </div>
              <button
                onClick={() => setSelectedInspection(null)}
                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              {/* Status */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Status</p>
                <div className="flex items-center gap-2">
                  {getStatusIcon(selectedInspection.status)}
                  <span className="font-medium text-slate-800">{selectedInspection.status}</span>
                </div>
              </div>

              {/* Last Inspection */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Last Inspection</p>
                <p className="text-sm text-slate-800">
                  {selectedInspection.lastInspectionDate !== '-'
                    ? new Date(selectedInspection.lastInspectionDate).toLocaleString()
                    : 'Not inspected'}
                </p>
              </div>

              {/* Connected Loads */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Connected Loads</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'welder', label: 'Welder', connected: selectedInspection.loads.welder },
                    { key: 'grinder', label: 'Grinder', connected: selectedInspection.loads.grinder },
                    { key: 'light', label: 'Light', connected: selectedInspection.loads.light },
                    { key: 'pump', label: 'Pump', connected: selectedInspection.loads.pump },
                  ].map((load) => (
                    <span
                      key={load.key}
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        load.connected
                          ? 'bg-blue-100 text-blue-700 border border-blue-200'
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}
                    >
                      {load.label}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Active: {getConnectedLoadsCount(selectedInspection.loads)} / 4
                </p>
              </div>

              {/* Memo */}
              {selectedInspection.memo && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">
                    {selectedInspection.memo}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg border border-slate-200 p-3 z-20">
          <p className="text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">Legend</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
              <span className="text-xs text-slate-600">Complete</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#3b82f6' }}></div>
              <span className="text-xs text-slate-600">In Progress</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#94a3b8' }}></div>
              <span className="text-xs text-slate-600">Pending</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloorPlanView;
