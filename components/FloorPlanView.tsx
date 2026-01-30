import React, { useState, useEffect, useMemo, useRef } from 'react';
import { InspectionRecord, QRCodeData } from '../types';
import { CheckCircle2, Clock, AlertCircle, X, QrCode, Edit2, Save, MapPin } from 'lucide-react';

interface FloorPlanViewProps {
  inspections: InspectionRecord[];
  /** QR 코드 목록 (동적 데이터) */
  qrCodes?: QRCodeData[];
  onSelectInspection?: (inspection: InspectionRecord) => void;
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  selectedInspectionId?: string | null;
  onSelectionChange?: (id: string | null) => void;
  selectedFloor?: 'F1' | 'B1';
  onFloorChange?: (floor: 'F1' | 'B1') => void;
  /** false면 마커 클릭/선택 시 상세 패널(모달)을 띄우지 않음 */
  showDetailPanel?: boolean;
  /** true면 상세 패널이 열릴 때 위치 수정 모드로 열림 */
  startInEditMode?: boolean;
}

/** MOCK_DATA와 동일: 1=F1, 2=F2, …, 6=F6, 7=B1, 8=B2. F1 탭에 1~6층, B1 탭에 7~8층 표시 */
const UPPER_FLOORS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'];
const BASEMENT_FLOORS = ['B1', 'B2'];
const FLOOR_LABEL_MAP: Record<string, string> = {
  '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
  '7': 'B1', '8': 'B2',
  'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
  'B1': 'B1', 'B2': 'B2',
};
/** QR/검사 데이터의 층 값(숫자 '1','7' 또는 레이블 'F1','B1')을 표준 레이블로 통일 */
const toFloorLabel = (floor: string | null): string | null => {
  if (!floor) return null;
  const key = String(floor).trim().toUpperCase();
  return FLOOR_LABEL_MAP[key] ?? floor;
};
const floorToTab = (floor: string): 'F1' | 'B1' =>
  BASEMENT_FLOORS.includes(toFloorLabel(floor) ?? '') ? 'B1' : 'F1';

interface QRLocation {
  id: string;
  location: string;
  floor: string;
  position: { x: number; y: number };
  qrId: string;
}

const FloorPlanView: React.FC<FloorPlanViewProps> = ({ 
  inspections, 
  qrCodes: propQrCodes = [],
  onSelectInspection, 
  onUpdateInspections,
  selectedInspectionId,
  onSelectionChange,
  selectedFloor: propSelectedFloor,
  onFloorChange,
  showDetailPanel = true,
  startInEditMode = false
}) => {
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [hoveredInspection, setHoveredInspection] = useState<InspectionRecord | null>(null);
  // qrCodes prop → qrLocations (동적 데이터)
  const qrLocations = useMemo(() => {
    const locations: QRLocation[] = [];
    propQrCodes.forEach((qr: QRCodeData) => {
      try {
        const qrData = JSON.parse(qr.qrData);
        let position = { x: 50, y: 50 };
        if (qrData.position && typeof qrData.position === 'object' && qrData.position.x != null && qrData.position.y != null) {
          position = { x: qrData.position.x, y: qrData.position.y };
        }
        if (position.x >= 0 && position.x <= 100 && position.y >= 0 && position.y <= 100) {
          locations.push({
            id: `qr-${qr.id}`,
            location: qr.location,
            floor: qr.floor,
            position,
            qrId: qr.id
          });
        }
      } catch {
        // skip
      }
    });
    return locations;
  }, [propQrCodes]);
  const savedQRCodesForMarkers = propQrCodes;
  const [isEditingInspectionPosition, setIsEditingInspectionPosition] = useState(false);
  const [editingPosition, setEditingPosition] = useState({ x: 0, y: 0 });
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [internalSelectedFloor, setInternalSelectedFloor] = useState<'F1' | 'B1'>('F1');
  const panelRef = useRef<HTMLDivElement>(null);
  /** 리스트/마커에서 다른 검사 항목을 선택했을 때만 층 동기화. 드롭다운으로 층만 바꾼 경우에는 덮어쓰지 않음 */
  const prevSelectedInspectionIdRef = useRef<string | null>(null);

  // prop으로 전달된 층수가 있으면 사용, 없으면 내부 상태 사용
  const selectedFloor = propSelectedFloor ?? internalSelectedFloor;

  const handleFloorChange = (floor: 'F1' | 'B1') => {
    if (onFloorChange) {
      onFloorChange(floor);
    } else {
      setInternalSelectedFloor(floor);
    }
  };

  // selectedInspectionId가 **다른 검사 항목으로** 변경될 때만 층 동기화 및 스크롤 (드롭다운으로 층만 바꾼 경우에는 유지)
  useEffect(() => {
    if (selectedInspectionId) {
      const inspection = inspections.find(i => i.panelNo === selectedInspectionId);
      if (inspection) {
        const selectionChanged = prevSelectedInspectionIdRef.current !== selectedInspectionId;
        prevSelectedInspectionIdRef.current = selectedInspectionId;

        if (selectionChanged) {
          // PNL NO.에서 층수 추출 (형식: 1, 2, 1-1, 2-1, 3-1-1 → 1=F1, 2=B1)
          const idParts = inspection.panelNo.trim().split('-').map((p: string) => p.trim());
          let inspectionFloor: 'F1' | 'B1' = 'F1';
          const floorMap: { [key: string]: 'F1' | 'B1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'B2' } = {
            '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
            '7': 'B1', '8': 'B2',
            'A': 'F1', 'B': 'B1', 'F1': 'F1', 'B1': 'B1',
            'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6', 'B2': 'B2',
          };
          if (idParts.length === 1 && idParts[0]) {
            inspectionFloor = floorMap[idParts[0].toUpperCase()] || 'F1';
          } else if (idParts.length >= 2) {
            const first = idParts[0]?.toUpperCase() || '';
            const second = idParts[1]?.toUpperCase() || '';
            inspectionFloor = floorMap[first] || (idParts.length >= 3 ? (floorMap[second] || 'F1') : 'F1');
          }
          const tabForFloor = floorToTab(inspectionFloor);
          if (tabForFloor !== selectedFloor) {
            handleFloorChange(tabForFloor);
            setTimeout(() => scrollToMarker(inspection), 300);
          } else {
            scrollToMarker(inspection);
          }
        }
      }
    } else {
      prevSelectedInspectionIdRef.current = null;
      setSelectedInspection(null);
    }
  }, [selectedInspectionId, inspections, selectedFloor]);

  // startInEditMode일 때 상세 패널이 열리면 위치 수정 모드로 시작
  useEffect(() => {
    if (startInEditMode && selectedInspection && onUpdateInspections) {
      setIsEditingInspectionPosition(true);
      setEditingPosition({
        x: selectedInspection.position?.x ?? 50,
        y: selectedInspection.position?.y ?? 50
      });
    }
  }, [startInEditMode, selectedInspection?.panelNo]);

  // 마커로 스크롤하는 헬퍼 함수
  const scrollToMarker = (inspection: InspectionRecord) => {
    // QRGenerator와 연동: 마커 선택 상태 동기화 및 Modal 표시
    setSelectedInspection(inspection);
    // 패널 위치 초기화
    setPanelPosition({ x: 0, y: 0 });
    
    // 마커로 스크롤 수행 (여러 번 시도하여 확실하게)
    const attemptScroll = (attempts: number = 0) => {
      if (attempts > 5) return; // 최대 5번 시도
      
      setTimeout(() => {
        const markerElement = document.querySelector(`[data-marker-id="${inspection.panelNo}"]`) as HTMLElement;
        if (markerElement) {
          // 마커가 보이는지 확인
          const rect = markerElement.getBoundingClientRect();
          const isVisible = rect.top >= 0 && rect.left >= 0 && 
                           rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
                           rect.right <= (window.innerWidth || document.documentElement.clientWidth);
          
          if (!isVisible || attempts === 0) {
            // scrollIntoView 사용 (가장 확실한 방법)
            markerElement.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center', 
              inline: 'center' 
            });
          }
        } else if (attempts < 5) {
          // 마커가 아직 렌더링되지 않았으면 재시도
          attemptScroll(attempts + 1);
        }
        
        // QRGenerator 왼쪽 패널 내에서만 스크롤 (main 스크롤 방지)
        const inspectionItem = document.querySelector(`[data-inspection-id="${inspection.panelNo}"]`) as HTMLElement;
        if (inspectionItem) {
          const scrollParent = inspectionItem.closest('.overflow-y-auto');
          if (scrollParent) {
            const parent = scrollParent as HTMLElement;
            const itemTop = inspectionItem.offsetTop;
            const itemHeight = inspectionItem.offsetHeight;
            const parentHeight = parent.clientHeight;
            const targetScroll = itemTop - parentHeight / 2 + itemHeight / 2;
            parent.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
          } else {
            inspectionItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }, attempts === 0 ? 100 : 200); // 첫 시도는 100ms, 재시도는 200ms
    };
    
    attemptScroll(0);
  };

  // 패널 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        // 마커 클릭은 제외
        const target = event.target as HTMLElement;
        if (!target.closest('[data-marker-id]')) {
          setSelectedInspection(null);
          if (onSelectionChange) {
            onSelectionChange(null);
          }
        }
      }
    };

    if (selectedInspection) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [selectedInspection, onSelectionChange]);

  // 드래그 핸들러
  const handleMouseDown = (e: React.MouseEvent) => {
    // 버튼이나 입력 필드 클릭은 드래그로 처리하지 않음
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) {
      return;
    }
    setIsDragging(true);
    setDragStart({
      x: e.clientX - panelPosition.x,
      y: e.clientY - panelPosition.y
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = e.clientX - dragStart.x;
        const newY = e.clientY - dragStart.y;
        
        // 화면 경계 내에서만 이동
        const maxX = window.innerWidth - 400; // 패널 너비 고려
        const maxY = window.innerHeight - 400; // 패널 높이 고려
        
        setPanelPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY))
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart, panelPosition]);

  const handleSaveInspectionPosition = () => {
    if (!selectedInspection || !onUpdateInspections) return;

    try {
      // InspectionRecord 위치 정보 업데이트
      const updatedInspections = inspections.map(inspection => 
        inspection.panelNo === selectedInspection.panelNo
          ? { ...inspection, position: { x: editingPosition.x, y: editingPosition.y } }
          : inspection
      );

      onUpdateInspections(updatedInspections);

      // 화면에 반영
      setSelectedInspection(prev => 
        prev ? { ...prev, position: { x: editingPosition.x, y: editingPosition.y } } : null
      );

      setIsEditingInspectionPosition(false);
      alert('위치가 저장되었습니다.');
    } catch (error) {
      console.error('Failed to save inspection position:', error);
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
    // QRGenerator와 연동: ID를 통해 양방향 동기화
    if (onSelectionChange) {
      onSelectionChange(inspection.panelNo);
    }
    if (onSelectInspection) {
      onSelectInspection(inspection);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 마커 클릭은 제외
    const target = e.target as HTMLElement;
    if (target.closest('[data-marker-id]')) {
      return;
    }

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const img = container.querySelector('img');
    
    if (!img) return;

    // 이미지의 실제 표시 영역 계산 (object-contain 고려)
    const imgRect = img.getBoundingClientRect();
    const imgNaturalWidth = img.naturalWidth;
    const imgNaturalHeight = img.naturalHeight;
    
    if (imgNaturalWidth === 0 || imgNaturalHeight === 0) return;

    // 이미지의 실제 표시 크기 계산
    const containerAspect = rect.width / rect.height;
    const imageAspect = imgNaturalWidth / imgNaturalHeight;
    
    let displayWidth: number;
    let displayHeight: number;
    let offsetX: number;
    let offsetY: number;

    if (imageAspect > containerAspect) {
      // 이미지가 컨테이너보다 넓음 (좌우 여백)
      displayWidth = rect.width;
      displayHeight = rect.width / imageAspect;
      offsetX = 0;
      offsetY = (rect.height - displayHeight) / 2;
    } else {
      // 이미지가 컨테이너보다 높음 (상하 여백)
      displayWidth = rect.height * imageAspect;
      displayHeight = rect.height;
      offsetX = (rect.width - displayWidth) / 2;
      offsetY = 0;
    }

    // 클릭한 위치를 이미지 기준으로 계산
    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;
    
    // 이미지 영역 내부인지 확인
    if (clickX < 0 || clickX > displayWidth || clickY < 0 || clickY > displayHeight) {
      return; // 이미지 영역 밖 클릭은 무시
    }
    
    // 퍼센트 좌표로 변환
    const x = (clickX / displayWidth) * 100;
    const y = (clickY / displayHeight) * 100;
    
    // 좌표를 0-100 범위로 제한
    const clampedX = Math.max(0, Math.min(100, x));
    const clampedY = Math.max(0, Math.min(100, y));

    // 선택된 inspection이 있으면 위치 업데이트
    if (selectedInspection && onUpdateInspections) {
      const updatedInspections = inspections.map(inspection => 
        inspection.panelNo === selectedInspection.panelNo
          ? { ...inspection, position: { x: clampedX, y: clampedY } }
          : inspection
      );

      onUpdateInspections(updatedInspections);
      
      // 화면에 반영
      setSelectedInspection(prev => 
        prev ? { ...prev, position: { x: clampedX, y: clampedY } } : null
      );
    } else {
      // 선택된 inspection이 없으면 가장 가까운 inspection 선택하거나 새로 생성
      // 여기서는 가장 가까운 inspection을 찾아서 선택
      const nearestInspection = inspections.find(inspection => {
        if (!inspection.position) return false;
        const dx = Math.abs(inspection.position.x - clampedX);
        const dy = Math.abs(inspection.position.y - clampedY);
        return dx < 5 && dy < 5; // 5% 이내에 있으면 선택
      });

      if (nearestInspection) {
        handleMarkerClick(nearestInspection);
        // 위치 업데이트
        if (onUpdateInspections) {
          const updatedInspections = inspections.map(inspection => 
            inspection.panelNo === nearestInspection.panelNo
              ? { ...inspection, position: { x: clampedX, y: clampedY } }
              : inspection
          );
          onUpdateInspections(updatedInspections);
        }
      }
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

  // Filter inspections that have position data and remove duplicates by panelNo
  const positionedInspections = useMemo(() => {
    const seen = new Set<string>();
    return inspections.filter(inspection => {
      if (!inspection.position) return false;
      if (seen.has(inspection.panelNo)) {
        return false;
      }
      seen.add(inspection.panelNo);
      return true;
    });
  }, [inspections]);

  // Combine inspections and QR locations for display
  // QR과 ID는 하나의 객체이므로 ID로 매칭하여 통합
  const allMarkers = useMemo(() => {
    const markers: Array<{
      id: string;
      type: 'inspection';
      position: { x: number; y: number };
      data: InspectionRecord;
      qrLocation?: QRLocation;
    }> = [];
    
    // ID 기준으로 중복 제거를 위한 Set
    const seenMarkerIds = new Set<string>();

    // QR 코드 데이터에서 ID 매핑 생성 (동적 데이터: propQrCodes)
    const qrMapByInspectionId = new Map<string, QRLocation>();
    qrLocations.forEach(qrLoc => {
      try {
        const qrCode = propQrCodes.find((qr: QRCodeData) => qr.id === qrLoc.qrId);
        if (qrCode) {
          const qrData = JSON.parse(qrCode.qrData);
          if (qrData.id) {
            qrMapByInspectionId.set(qrData.id, qrLoc);
          }
        }
      } catch (e) {
        // 무시
      }
    });

    // InspectionRecord를 기준으로 마커 생성 (QR 정보 포함)
    positionedInspections.forEach(inspection => {
      if (inspection.position) {
        const qrLocation = qrMapByInspectionId.get(inspection.panelNo);
        
        // 층수 필터링: QR 코드의 층수 정보와 선택된 층이 일치하는 경우만 표시
        let shouldShow = false;
        let markerFloor: string | null = null;
        
        if (qrLocation) {
          // QR 코드에 층수 정보가 있으면 그것을 사용
          markerFloor = qrLocation.floor;
        } else {
          // QR 코드 정보가 없으면 propQrCodes에서 직접 확인
          try {
            const qrCode = propQrCodes.find((qr: QRCodeData) => {
              try {
                const qrData = JSON.parse(qr.qrData);
                return qrData.id === inspection.panelNo;
              } catch {
                return false;
              }
            });
            
            if (qrCode) {
              markerFloor = qrCode.floor;
            }
          } catch (e) {
            // 무시
          }
        }
        
        // QR 코드에 층수 정보가 없으면 PNL NO.에서 추출 (형식: 1, 2, 1-1, 2-1, 3-1-1 → 1=F1, 2=B1)
        if (!markerFloor && inspection.panelNo) {
          const idParts = inspection.panelNo.trim().split('-').map((p: string) => p.trim());
          const floorMap: { [key: string]: string } = {
            '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
            '7': 'B1', '8': 'B2',
            'A': 'F1', 'B': 'B1', 'F1': 'F1', 'B1': 'B1',
            'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6', 'B2': 'B2',
          };
          if (idParts.length === 1 && idParts[0]) {
            markerFloor = floorMap[idParts[0].toUpperCase()] || 'F1';
          } else if (idParts.length >= 2) {
            const first = idParts[0]?.toUpperCase() || '';
            const second = idParts[1]?.toUpperCase() || '';
            markerFloor = floorMap[first] || (idParts.length >= 3 ? (floorMap[second] || 'F1') : 'F1');
          }
        }
        
        // 층수 일치: F1 탭 = F1~F6, B1 탭 = B1~B2. QR/검사 데이터의 층이 숫자('1','7')여도 레이블로 정규화 후 비교
        const normalizedFloor = toFloorLabel(markerFloor);
        if (!normalizedFloor) {
          shouldShow = true;
        } else if (selectedFloor === 'F1' && UPPER_FLOORS.includes(normalizedFloor)) {
          shouldShow = true;
        } else if (selectedFloor === 'B1' && BASEMENT_FLOORS.includes(normalizedFloor)) {
          shouldShow = true;
        }
        
        // 층에 맞는 마커만 추가 (panelNo 중복 체크)
        if (shouldShow && !seenMarkerIds.has(inspection.panelNo)) {
          seenMarkerIds.add(inspection.panelNo);
          markers.push({
            id: inspection.panelNo,
            type: 'inspection',
            position: inspection.position,
            data: inspection,
            qrLocation: qrLocation
          });
        }
      }
    });
    
    // 디버깅: 마커 개수 확인
    console.log('Total markers for floor', selectedFloor, ':', markers.length, 'Positioned inspections:', positionedInspections.length, 'Unique IDs:', seenMarkerIds.size);

    return markers;
  }, [positionedInspections, qrLocations, selectedFloor]);

  // 층에 따른 이미지 경로 결정
  const floorImagePath = selectedFloor === 'F1' ? '/1st Floor.jpg' : '/Basement.jpg';

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Distribution Board Locations</h3>
          <p className="text-sm text-slate-600 mt-1">
            {allMarkers.length} board{allMarkers.length !== 1 ? 's' : ''} mapped on floor plan
            {allMarkers.length === 0 && (
              <span className="text-red-600 font-bold ml-2">⚠️ 위젯이 표시되지 않습니다. 위치 정보가 있는 검사 항목이 없습니다.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">층 선택:</label>
          <select
            value={selectedFloor}
            onChange={(e) => handleFloorChange(e.target.value as 'F1' | 'B1')}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none cursor-pointer"
          >
            <option value="F1">F1</option>
            <option value="B1">B1</option>
          </select>
        </div>
      </div>

      <div className="relative bg-slate-100" style={{ minHeight: '600px' }}>
        {/* Floor Plan Image - 숨김 처리, 위젯만 표시 */}
        <div 
          className="relative w-full h-full cursor-crosshair" 
          style={{ minHeight: '600px' }}
          onClick={handleImageClick}
        >
          {/* Floor Plan Image - 낮은 해상도, 최하위 z-index */}
          <img
            src={floorImagePath}
            alt={`${selectedFloor === 'F1' ? 'F1' : 'B1'} Floor Plan`}
            className="w-full h-auto object-contain pointer-events-none"
            style={{ 
              minHeight: '600px', 
              objectFit: 'contain',
              imageRendering: 'pixelated', // 해상도 낮춤
              opacity: 0.7, // 약간 투명하게
              zIndex: 0, // 최하위
            }}
            onError={(e) => {
              // Fallback if image fails to load
              const img = e.currentTarget as HTMLImageElement;
              img.src = 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&h=800&fit=crop';
            }}
          />

          {/* Markers */}
          {allMarkers.length === 0 && (
            <div className="absolute top-4 left-4 bg-red-500 text-white p-4 rounded-lg shadow-xl z-50">
              <p className="font-bold">⚠️ 위젯이 없습니다!</p>
              <p className="text-sm mt-1">위치 정보가 있는 검사 항목: {positionedInspections.length}개</p>
              <p className="text-sm">표시할 마커: {allMarkers.length}개</p>
            </div>
          )}
          {allMarkers.map((marker) => {
            const { x, y } = marker.position;
            const inspection = marker.data;
            const statusColor = getStatusColor(inspection.status);
            const isSelected = selectedInspection?.panelNo === marker.id;
            const isHovered = hoveredInspection?.panelNo === marker.id;

            return (
              <div
                key={marker.id}
                data-marker-id={marker.id}
                data-inspection-id={inspection.panelNo}
                data-selected={isSelected ? 'true' : 'false'}
                className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-transform cursor-pointer"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  padding: '6px',
                  zIndex: 100,
                }}
                onClick={() => handleMarkerClick(inspection)}
                onMouseEnter={() => setHoveredInspection(inspection)}
                onMouseLeave={() => setHoveredInspection(null)}
              >
                {/* panelNo 라벨 (점 위쪽) */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm"
                  style={{
                    bottom: '100%',
                    marginBottom: '4px',
                    backgroundColor: statusColor,
                  }}
                >
                  {inspection.panelNo}
                </div>
                {/* 작은 점/원 */}
                <div
                  className="rounded-full transition-transform"
                  style={{
                    width: isSelected || isHovered ? '14px' : '10px',
                    height: isSelected || isHovered ? '14px' : '10px',
                    backgroundColor: statusColor,
                    border: '2px solid white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Selected Inspection Details Panel (showDetailPanel=false면 목록 선택 시 모달 미표시) */}
        {showDetailPanel && selectedInspection && (() => {
          // QR 정보 찾기
          const qrLocation = allMarkers.find(m => m.id === selectedInspection.panelNo)?.qrLocation;
          
          return (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black bg-opacity-30 z-40"
              onClick={() => {
                setSelectedInspection(null);
                if (onSelectionChange) {
                  onSelectionChange(null);
                }
              }}
            />
            {/* Popup Panel */}
            <div 
              ref={panelRef}
              className={`fixed bg-white rounded-xl shadow-2xl border border-slate-200 p-6 max-w-md ${isDragging ? 'cursor-grabbing' : 'cursor-move'}`}
              style={{
                left: panelPosition.x === 0 ? '50%' : `${panelPosition.x}px`,
                top: panelPosition.y === 0 ? '50%' : `${panelPosition.y}px`,
                transform: panelPosition.x === 0 && panelPosition.y === 0 ? 'translate(-50%, -50%)' : 'none',
                zIndex: 100,
              }}
              onMouseDown={handleMouseDown}
            >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-bold text-slate-800 text-lg mb-0.5">{selectedInspection.panelNo}</h4>
                <p className="text-sm text-slate-600">Distribution Board</p>
                {qrLocation && (
                  <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                    <QrCode size={12} />
                    QR: {qrLocation.location} ({qrLocation.floor})
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!isEditingInspectionPosition ? (
                  <button
                    onClick={() => {
                      setIsEditingInspectionPosition(true);
                      setEditingPosition({ 
                        x: selectedInspection.position?.x || 50, 
                        y: selectedInspection.position?.y || 50 
                      });
                    }}
                    className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                    title="위치 수정"
                  >
                    <Edit2 size={18} />
                  </button>
                ) : (
                  <button
                    onClick={handleSaveInspectionPosition}
                    className="p-1 hover:bg-emerald-50 rounded text-slate-400 hover:text-emerald-600 transition-colors"
                    title="저장"
                  >
                    <Save size={18} />
                  </button>
                )}
                <button
                  onClick={() => {
                    setSelectedInspection(null);
                    setIsEditingInspectionPosition(false);
                  }}
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>
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

              {/* Position */}
              {selectedInspection.position && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-2">
                    <MapPin size={12} />
                    Position
                  </p>
                  {isEditingInspectionPosition ? (
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
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
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
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                      </div>
                      <div className="col-span-2 flex gap-2 mt-2">
                        <button
                          onClick={handleSaveInspectionPosition}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                          <Save size={14} />
                          저장
                        </button>
                        <button
                          onClick={() => {
                            setIsEditingInspectionPosition(false);
                            setEditingPosition({ 
                              x: selectedInspection.position?.x || 50, 
                              y: selectedInspection.position?.y || 50 
                            });
                          }}
                          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-800 font-medium">
                      X: {selectedInspection.position.x}%, Y: {selectedInspection.position.y}%
                    </p>
                  )}
                </div>
              )}

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
           </>
           );
         })()}


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
