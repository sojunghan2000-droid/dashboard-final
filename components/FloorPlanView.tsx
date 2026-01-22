import React, { useState, useEffect, useMemo } from 'react';
import { InspectionRecord, QRCodeData } from '../types';
import { CheckCircle2, Clock, AlertCircle, X, QrCode, Edit2, Save, MapPin } from 'lucide-react';

interface FloorPlanViewProps {
  inspections: InspectionRecord[];
  onSelectInspection?: (inspection: InspectionRecord) => void;
}

interface QRLocation {
  id: string;
  location: string;
  floor: string;
  position: { x: number; y: number };
  qrId: string;
}

const FloorPlanView: React.FC<FloorPlanViewProps> = ({ inspections, onSelectInspection }) => {
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [hoveredInspection, setHoveredInspection] = useState<InspectionRecord | null>(null);
  const [selectedQRLocation, setSelectedQRLocation] = useState<QRLocation | null>(null);
  const [qrLocations, setQRLocations] = useState<QRLocation[]>([]);
  const [isEditingQRPosition, setIsEditingQRPosition] = useState(false);
  const [editingPosition, setEditingPosition] = useState({ x: 0, y: 0 });

  // Load QR mapping data from localStorage
  useEffect(() => {
    loadQRMappings();
  }, []);

  const loadQRMappings = () => {
    try {
      // Load dashboard mapping
      const mappingData = localStorage.getItem('dashboard_qr_mapping');
      if (mappingData) {
        const mapping = JSON.parse(mappingData);
        
        // Parse position from QR data
        let position = { x: 50, y: 50 }; // default
        try {
          const qrData = JSON.parse(mapping.qrData);
          // Try to parse position from position object
          if (qrData.position) {
            if (typeof qrData.position === 'object' && qrData.position.x !== undefined && qrData.position.y !== undefined) {
              position = { x: qrData.position.x, y: qrData.position.y };
            } else if (typeof qrData.position === 'string') {
              const match = qrData.position.match(/x[:\s]*(\d+)[,\s]*y[:\s]*(\d+)/i);
              if (match) {
                position = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
              }
            }
          }
        } catch (e) {
          console.error('Failed to parse QR position:', e);
        }

        const qrLocation: QRLocation = {
          id: `qr-${mapping.qrId}`,
          location: mapping.location,
          floor: mapping.floor,
          position: position,
          qrId: mapping.qrId
        };

        setQRLocations([qrLocation]);
      }

      // Also load all saved QR codes and try to extract position info
      const savedQRCodes = JSON.parse(localStorage.getItem('safetyguard_qrcodes') || '[]');
      const additionalLocations: QRLocation[] = savedQRCodes
        .map((qr: QRCodeData) => {
          try {
            const qrData = JSON.parse(qr.qrData);
            let position = { x: 50, y: 50 };
            
            if (qrData.position) {
              if (typeof qrData.position === 'object' && qrData.position.x !== undefined && qrData.position.y !== undefined) {
                position = { x: qrData.position.x, y: qrData.position.y };
              } else if (typeof qrData.position === 'string') {
                const match = qrData.position.match(/x[:\s]*(\d+)[,\s]*y[:\s]*(\d+)/i);
                if (match) {
                  position = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
                }
              }
            }

            // Only include if position coordinates are valid
            if (position.x >= 0 && position.x <= 100 && position.y >= 0 && position.y <= 100) {
              return {
                id: `qr-${qr.id}`,
                location: qr.location,
                floor: qr.floor,
                position: position,
                qrId: qr.id
              };
            }
            return null;
          } catch (e) {
            return null;
          }
        })
        .filter((loc: QRLocation | null) => loc !== null);

      // Merge with existing locations, avoiding duplicates
      setQRLocations(prev => {
        const merged = [...prev];
        additionalLocations.forEach(newLoc => {
          if (!merged.find(loc => loc.qrId === newLoc.qrId)) {
            merged.push(newLoc);
          }
        });
        return merged;
      });
    } catch (error) {
      console.error('Failed to load QR mappings:', error);
    }
  };

  // Refresh QR locations when component mounts or when storage changes
  useEffect(() => {
    const interval = setInterval(() => {
      loadQRMappings();
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, []);

  const handleSaveQRPosition = () => {
    if (!selectedQRLocation) return;

    try {
      // QR 코드 데이터를 localStorage에서 찾아서 업데이트
      const savedQRCodes = JSON.parse(localStorage.getItem('safetyguard_qrcodes') || '[]');
      const qrCode = savedQRCodes.find((qr: QRCodeData) => qr.id === selectedQRLocation.qrId);

      if (qrCode) {
        // QR 데이터 파싱
        const qrData = JSON.parse(qrCode.qrData);
        
        // 위치 정보 업데이트
        qrData.position = {
          description: qrData.position?.description || qrCode.position || '',
          x: editingPosition.x,
          y: editingPosition.y
        };

        // 업데이트된 QR 데이터 저장
        qrCode.qrData = JSON.stringify(qrData);
        localStorage.setItem('safetyguard_qrcodes', JSON.stringify(savedQRCodes));

        // Dashboard 매핑도 업데이트
        const mappingData = localStorage.getItem('dashboard_qr_mapping');
        if (mappingData) {
          const mapping = JSON.parse(mappingData);
          if (mapping.qrId === selectedQRLocation.qrId) {
            mapping.qrData = qrCode.qrData;
            localStorage.setItem('dashboard_qr_mapping', JSON.stringify(mapping));
          }
        }

        // 화면에 반영
        setQRLocations(prev => 
          prev.map(loc => 
            loc.id === selectedQRLocation.id 
              ? { ...loc, position: { x: editingPosition.x, y: editingPosition.y } }
              : loc
          )
        );

        setSelectedQRLocation(prev => 
          prev ? { ...prev, position: { x: editingPosition.x, y: editingPosition.y } } : null
        );

        setIsEditingQRPosition(false);
        alert('위치가 저장되었습니다.');
      } else {
        alert('QR 코드를 찾을 수 없습니다.');
      }
    } catch (error) {
      console.error('Failed to save QR position:', error);
      alert('위치 저장에 실패했습니다.');
    }
  };

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

  // Combine inspections and QR locations for display
  const allMarkers = useMemo(() => {
    const markers: Array<{
      id: string;
      type: 'inspection' | 'qr';
      position: { x: number; y: number };
      data: InspectionRecord | QRLocation;
    }> = [];

    // Add inspection markers
    positionedInspections.forEach(inspection => {
      if (inspection.position) {
        markers.push({
          id: inspection.id,
          type: 'inspection',
          position: inspection.position,
          data: inspection
        });
      }
    });

    // Add QR location markers
    qrLocations.forEach(qrLoc => {
      markers.push({
        id: qrLoc.id,
        type: 'qr',
        position: qrLoc.position,
        data: qrLoc
      });
    });

    return markers;
  }, [positionedInspections, qrLocations]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50">
        <h3 className="text-lg font-semibold text-slate-800">Distribution Board Locations</h3>
        <p className="text-sm text-slate-600 mt-1">
          {positionedInspections.length} board{positionedInspections.length !== 1 ? 's' : ''} 
          {qrLocations.length > 0 && `, ${qrLocations.length} QR location${qrLocations.length !== 1 ? 's' : ''}`} mapped on floor plan
        </p>
      </div>

      <div className="relative bg-slate-100" style={{ minHeight: '600px' }}>
        {/* Floor Plan Image */}
        <div className="relative w-full h-full" style={{ minHeight: '600px' }}>
          <img
            src="/Plan DW.jpg"
            alt="Floor Plan"
            className="w-full h-auto object-contain"
            style={{ minHeight: '600px', objectFit: 'contain' }}
            onError={(e) => {
              // Fallback if image fails to load
              const img = e.currentTarget as HTMLImageElement;
              img.src = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=800&fit=crop';
            }}
          />

          {/* Markers */}
          {allMarkers.map((marker) => {
            const { x, y } = marker.position;
            const isInspection = marker.type === 'inspection';
            const inspection = isInspection ? (marker.data as InspectionRecord) : null;
            const qrLocation = !isInspection ? (marker.data as QRLocation) : null;
            
            const statusColor = isInspection ? getStatusColor(inspection!.status) : '#8b5cf6'; // purple for QR
            const isSelected = isInspection 
              ? selectedInspection?.id === marker.id
              : selectedQRLocation?.id === marker.id;
            const isHovered = isInspection
              ? hoveredInspection?.id === marker.id
              : false;

            return (
              <div
                key={marker.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all z-10"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                }}
                onClick={() => {
                  if (isInspection && inspection) {
                    handleMarkerClick(inspection);
                  } else if (qrLocation) {
                    setSelectedQRLocation(qrLocation);
                    setSelectedInspection(null);
                  }
                }}
                onMouseEnter={() => {
                  if (isInspection && inspection) {
                    setHoveredInspection(inspection);
                  }
                }}
                onMouseLeave={() => {
                  if (isInspection) {
                    setHoveredInspection(null);
                  }
                }}
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
                      width: isInspection ? '24px' : '28px',
                      height: isInspection ? '24px' : '28px',
                    }}
                  >
                    {isInspection ? getStatusIcon(inspection!.status) : <QrCode size={16} className="text-white" />}
                  </div>

                  {/* Tooltip on hover */}
                  {isHovered && !isSelected && isInspection && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl whitespace-nowrap z-20">
                      <div className="font-semibold mb-1">{inspection.id}</div>
                      <div className="text-slate-300">{inspection.status}</div>
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
                        <div className="border-4 border-transparent border-t-slate-900"></div>
                      </div>
                    </div>
                  )}
                  {!isInspection && qrLocation && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-purple-900 text-white text-xs rounded-lg shadow-xl whitespace-nowrap z-20">
                      <div className="font-semibold mb-1">QR: {qrLocation.location}</div>
                      <div className="text-purple-300">{qrLocation.floor}</div>
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
                        <div className="border-4 border-transparent border-t-purple-900"></div>
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
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-bold text-slate-800 text-lg mb-0.5">{selectedInspection.id}</h4>
                <p className="text-sm text-slate-600">Distribution Board</p>
              </div>
              <button
                onClick={() => {
                  setSelectedInspection(null);
                  setSelectedQRLocation(null);
                }}
                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Status */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Status</p>
                <div className="flex items-center gap-2">
                  {getStatusIcon(selectedInspection.status)}
                  <span className="text-sm text-slate-800 font-medium">{selectedInspection.status}</span>
                </div>
              </div>

              {/* Last Inspection */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Last Inspection</p>
                <p className="text-sm text-slate-800 font-medium">
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

        {/* Selected QR Location Details Panel */}
        {selectedQRLocation && (
          <div className="absolute bottom-4 left-4 right-4 bg-white rounded-lg shadow-xl border border-slate-200 p-4 z-30 max-w-md">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-bold text-slate-800 text-lg mb-0.5">{selectedQRLocation.location}</h4>
                <p className="text-sm text-slate-600">QR Location</p>
              </div>
              <div className="flex items-center gap-1">
                {!isEditingQRPosition ? (
                  <button
                    onClick={() => {
                      setIsEditingQRPosition(true);
                      setEditingPosition({ x: selectedQRLocation.position.x, y: selectedQRLocation.position.y });
                    }}
                    className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                    title="위치 수정"
                  >
                    <Edit2 size={18} />
                  </button>
                ) : (
                  <button
                    onClick={handleSaveQRPosition}
                    className="p-1 hover:bg-emerald-50 rounded text-slate-400 hover:text-emerald-600 transition-colors"
                    title="저장"
                  >
                    <Save size={18} />
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedQRLocation(null);
                    setSelectedInspection(null);
                    setIsEditingQRPosition(false);
                  }}
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* Location */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Location</p>
                <p className="text-sm text-slate-800 font-medium">{selectedQRLocation.location}</p>
              </div>

              {/* Floor */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Floor</p>
                <p className="text-sm text-slate-800 font-medium">{selectedQRLocation.floor}</p>
              </div>

              {/* Position */}
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Position</p>
                {isEditingQRPosition ? (
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">X 좌표 (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={editingPosition.x}
                        onChange={(e) => setEditingPosition(prev => ({ ...prev, x: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Y 좌표 (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={editingPosition.y}
                        onChange={(e) => setEditingPosition(prev => ({ ...prev, y: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="col-span-2 flex gap-2 mt-2">
                      <button
                        onClick={handleSaveQRPosition}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <Save size={14} />
                        저장
                      </button>
                      <button
                        onClick={() => {
                          setIsEditingQRPosition(false);
                          setEditingPosition({ x: selectedQRLocation.position.x, y: selectedQRLocation.position.y });
                        }}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-800 font-medium">
                    X: {selectedQRLocation.position.x}%, Y: {selectedQRLocation.position.y}%
                  </p>
                )}
              </div>
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
            {qrLocations.length > 0 && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#8b5cf6' }}></div>
                <span className="text-xs text-slate-600">QR Location</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FloorPlanView;
