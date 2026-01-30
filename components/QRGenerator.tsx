import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Download, Printer, MapPin, Building2, FileText, Calendar, Trash2, Eye, Edit2, X, Save } from 'lucide-react';
import { QRCodeData, InspectionRecord } from '../types';
import FloorPlanView from './FloorPlanView';

/** TR(위치) 허용 값: A, B, C, D */
const TR_OPTIONS = ['A', 'B', 'C', 'D'] as const;
const isValidTR = (v: string): v is typeof TR_OPTIONS[number] =>
  TR_OPTIONS.includes(v as typeof TR_OPTIONS[number]);

/** PNL NO. 형식: MOCK_DATA와 동일. 층 1=F1, 2=F2, …, 6=F6, 7=B1, 8=B2 / TR A,B,C,D → 1,2,3,4 */
const FLOOR_TO_NUM: Record<string, string> = { F1: '1', B1: '7' };
const NUM_TO_FLOOR: Record<string, string> = {
  '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6', '7': 'B1', '8': 'B2',
};
const TR_TO_NUM: Record<string, string> = { A: '1', B: '2', C: '3', D: '4' };
const NUM_TO_TR: Record<string, string> = { '1': 'A', '2': 'B', '3': 'C', '4': 'D' };

/** 층(F1/B1) + TR(A/B/C/D) → PNL NO.(1-1, 2-1 등) */
function toPnlNo(floor: string, location: string): string {
  const f = FLOOR_TO_NUM[floor] || floor;
  const l = TR_TO_NUM[location?.toUpperCase()] ?? location;
  return `${f}-${l}`;
}

/** PNL NO.(1, 1-1, 2-1, 3-1-1)에서 층 추출 → F1/B1 */
function pnlNoToFloor(pnlNo: string): string {
  if (!pnlNo || typeof pnlNo !== 'string') return 'F1';
  const parts = pnlNo.trim().split('-');
  const first = parts[0]?.trim() || '';
  return NUM_TO_FLOOR[first] || (first === '1' ? 'F1' : first === '7' ? 'B1' : 'F1');
}

/** 목록 표시용: 층 값(1~8 또는 F1/B1) → F1, F2, … F6, B1, B2 */
const FLOOR_DISPLAY: Record<string, string> = {
  '1': 'F1', '2': 'F2', '3': 'F3', '4': 'F4', '5': 'F5', '6': 'F6',
  '7': 'B1', '8': 'B2',
  'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4', 'F5': 'F5', 'F6': 'F6',
  'B1': 'B1', 'B2': 'B2',
};
function floorToDisplayLabel(floor: string): string {
  if (!floor) return '';
  const key = String(floor).trim().toUpperCase();
  return FLOOR_DISPLAY[key] ?? floor;
}

interface QRData {
  id: string;
  location: string;
  floor: string;
  position: string;
  positionX: string;
  positionY: string;
}

// requestIdleCallback 폴백 (성능 개선을 위한 비동기 처리)
const requestIdleCallback = (window.requestIdleCallback || ((cb: IdleRequestCallback) => {
  const start = Date.now();
  return setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
    });
  }, 1);
})) as typeof window.requestIdleCallback;

interface QRGeneratorProps {
  inspections?: InspectionRecord[];
  /** QR 코드 목록 (동적 데이터, App state) */
  qrCodes?: QRCodeData[];
  /** QR 코드 목록 갱신 콜백 */
  onQrCodesChange?: (codes: QRCodeData[]) => void;
  onSelectInspection?: (inspectionId: string) => void;
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
  /** main 스크롤 유지용 (App의 main ref) */
  mainScrollRef?: React.RefObject<HTMLElement | null>;
}

const QRGenerator: React.FC<QRGeneratorProps> = ({ 
  inspections = [], 
  qrCodes: propQrCodes = [],
  onQrCodesChange,
  onSelectInspection,
  onUpdateInspections,
  mainScrollRef
}) => {
  const qrCodes = propQrCodes;
  const setQrCodes = useCallback((updater: QRCodeData[] | ((prev: QRCodeData[]) => QRCodeData[])) => {
    if (!onQrCodesChange) return;
    const next = typeof updater === 'function' ? updater(propQrCodes) : updater;
    onQrCodesChange(next);
  }, [onQrCodesChange, propQrCodes]);

  const [selectedFloor, setSelectedFloor] = useState<'F1' | 'B1'>('F1');
  const [qrData, setQrData] = useState<QRData>({
    id: 'A', // PNL NO. 초기값
    location: 'A',
    floor: 'F1',
    position: '',
    positionX: '',
    positionY: ''
  });
  const [generatedQR, setGeneratedQR] = useState<string | null>(null);
  const [savedQRId, setSavedQRId] = useState<string | null>(null);
  const [selectedQR, setSelectedQR] = useState<QRCodeData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isSelectFocused, setIsSelectFocused] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  /** true일 때만 FloorPlanView 상세 패널(모달) 표시 - "Dashboard에 위치 매핑" 클릭 시 true */
  const [openDetailPanelForMapping, setOpenDetailPanelForMapping] = useState(false);
  const rightPanelScrollRef = useRef<HTMLDivElement>(null);
  const savedMainScrollOnInteractionRef = useRef<number>(0);
  const savedRightScrollOnInteractionRef = useRef<number>(0);

  const restoreMainScrollOnFocus = useCallback(() => {
    const restore = () => {
      if (mainScrollRef?.current != null) {
        mainScrollRef.current.scrollTop = savedMainScrollOnInteractionRef.current;
      }
      if (rightPanelScrollRef.current != null) {
        rightPanelScrollRef.current.scrollTop = savedRightScrollOnInteractionRef.current;
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(restore);
    });
    setTimeout(restore, 80);
  }, [mainScrollRef]);

  /** 버튼 클릭 후 리렌더/alert 등으로 스크롤이 바뀐 뒤 여러 번 복원 (onMouseDown에서 저장된 값 사용) */
  const restoreScrollAfterAction = useCallback(() => {
    const restore = () => {
      if (mainScrollRef?.current != null) {
        mainScrollRef.current.scrollTop = savedMainScrollOnInteractionRef.current;
      }
      if (rightPanelScrollRef.current != null) {
        rightPanelScrollRef.current.scrollTop = savedRightScrollOnInteractionRef.current;
      }
    };
    [120, 280, 450].forEach((ms) => setTimeout(restore, ms));
  }, [mainScrollRef]);

  const registerAllQRCodesAsInspections = useCallback(() => {
    if (!onUpdateInspections) return;

    const savedQRCodes = qrCodes;
    const newInspections: InspectionRecord[] = [];

    savedQRCodes.forEach((qr: QRCodeData) => {
      try {
        const qrData = JSON.parse(qr.qrData);
        const position = qrData.position || {};
        
        // 이미 존재하는 InspectionRecord인지 확인
        const locationCode = qr.location.replace(/\s+/g, '-').toUpperCase();
        const floorCode = qr.floor.replace(/\s+/g, '').toUpperCase();
        
        // PNL NO.로 먼저 확인 (정확한 매칭)
        const existingInspectionById = inspections.find(inspection => {
          try {
            const qrDataId = qrData.id;
            return inspection.panelNo === qrDataId;
          } catch {
            return false;
          }
        });

        // PNL NO.로 찾지 못한 경우에만 패턴 매칭 시도
        const existingInspection = existingInspectionById || inspections.find(inspection => {
          if (inspection.panelNo.includes(locationCode) || inspection.panelNo.includes(floorCode)) {
            return true;
          }
          // 위치 좌표 매칭
          if (position.x !== undefined && position.y !== undefined && inspection.position) {
            const dx = Math.abs(inspection.position.x - position.x);
            const dy = Math.abs(inspection.position.y - position.y);
            if (dx < 5 && dy < 5) {
              return true;
            }
          }
          return false;
        });

        if (!existingInspection) {
          // 새 InspectionRecord 생성
          const positionObj = position.x !== undefined && position.y !== undefined 
            ? { x: position.x, y: position.y }
            : undefined;

          const newPanelNo = qrData.id?.trim() || qrData.panelNo || (isValidTR(qr.location) ? toPnlNo(qr.floor, qr.location) : `${FLOOR_TO_NUM[qr.floor] || qr.floor}-${qr.location}`);
          const alreadyInNewInspections = newInspections.some(ins => ins.panelNo === newPanelNo);
          
          if (!alreadyInNewInspections) {
            const newInspection: InspectionRecord = {
              panelNo: newPanelNo,
              status: 'Pending',
              lastInspectionDate: '-',
              loads: { welder: false, grinder: false, light: false, pump: false },
              photoUrl: null,
              memo: `QR 코드로 생성됨\n위치: ${qr.location}\n층수: ${qr.floor}\n위치 정보: ${qr.position}`,
              position: positionObj
            };

            newInspections.push(newInspection);
          }
        }
      } catch (e) {
        console.error('Failed to register QR code as inspection:', e);
      }
    });

    if (newInspections.length > 0) {
      const existingPanelNos = new Set(inspections.map(ins => ins.panelNo));
      const uniqueNewInspections = newInspections.filter(ins => !existingPanelNos.has(ins.panelNo));
      
      if (uniqueNewInspections.length > 0) {
        const uniqueExistingInspections = inspections.filter((inspection, index, self) =>
          index === self.findIndex(i => i.panelNo === inspection.panelNo)
        );
        const updatedInspections = [...uniqueNewInspections, ...uniqueExistingInspections];
        onUpdateInspections(updatedInspections);
      } else {
        const uniqueExistingInspections = inspections.filter((inspection, index, self) =>
          index === self.findIndex(i => i.panelNo === inspection.panelNo)
        );
        if (uniqueExistingInspections.length !== inspections.length) {
          onUpdateInspections(uniqueExistingInspections);
        }
      }
    } else {
      const uniqueExistingInspections = inspections.filter((inspection, index, self) =>
        index === self.findIndex(i => i.panelNo === inspection.panelNo)
      );
      if (uniqueExistingInspections.length !== inspections.length) {
        onUpdateInspections(uniqueExistingInspections);
      }
    }
  }, [inspections, onUpdateInspections]);

  // QR 코드 목록이 변경될 때마다 InspectionRecord로 등록
  useEffect(() => {
    if (qrCodes.length > 0) {
      registerAllQRCodesAsInspections();
    }
  }, [qrCodes.length, registerAllQRCodesAsInspections]);

  // 모든 InspectionRecord에 대해 QR 코드 자동 생성
  useEffect(() => {
    if (inspections.length === 0) return;

    const savedQRCodes: QRCodeData[] = qrCodes;
    const existingQRIds = new Set<string>();
    
    // 기존 QR 코드에서 ID 추출
    savedQRCodes.forEach(qr => {
      try {
        const qrData = JSON.parse(qr.qrData);
        if (qrData.id) {
          existingQRIds.add(qrData.id);
        }
      } catch (e) {
        // 무시
      }
    });

    // QR 코드가 없는 InspectionRecord 찾기
    const inspectionsWithoutQR = inspections.filter(inspection => {
      return !existingQRIds.has(inspection.panelNo);
    });

    if (inspectionsWithoutQR.length === 0) return;

    const newQRCodes: QRCodeData[] = [];
    inspectionsWithoutQR.forEach(inspection => {
      const idParts = inspection.panelNo.split('-');
      let location = '';
      let floor = '';
      
      if (idParts.length >= 3) {
        floor = idParts[1] || '';
        location = idParts[2] || '';
      } else if (idParts.length >= 2) {
        floor = idParts[1] || '';
      }

      if (!location) location = inspection.panelNo;
      if (!floor) floor = '1';

      const position = {
        description: inspection.memo || '',
        x: inspection.position?.x,
        y: inspection.position?.y
      };

      const qrDataString = JSON.stringify({
        id: inspection.panelNo,
        location: location,
        floor: floor,
        position: position,
        timestamp: new Date().toISOString(),
        // InspectionRecord의 기본 정보 포함
        panelNo: inspection.panelNo,
        projectName: inspection.projectName,
        contractor: inspection.contractor,
        managementNumber: inspection.managementNumber
      });

      const newQRCode: QRCodeData = {
        id: `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        location: location,
        floor: floor,
        position: inspection.memo || '',
        qrData: qrDataString,
        createdAt: new Date().toISOString()
      };

      newQRCodes.push(newQRCode);
    });

    if (newQRCodes.length > 0) {
      const updatedQRCodes = [...savedQRCodes, ...newQRCodes];
      setQrCodes(updatedQRCodes);
    }
  }, [inspections, qrCodes, setQrCodes]);

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
        } else {
          migrated[key] = migrateFloorFormat(data[key]);
        }
      }
      return migrated;
    }
    return data;
  };

  const handleInputChange = (field: keyof QRData, value: string) => {
    // #region agent log
    if (field === 'floor') {
      // 비동기 처리로 성능 개선
      requestIdleCallback(() => {
        fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:281',message:'handleInputChange called for floor',data:{field,oldValue:qrData.floor,newValue:value},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      }, { timeout: 1000 });
    }
    // #endregion
    setQrData(prev => {
      const updated = {
        ...prev,
        [field]: value
      };
      
      // PNL NO. 입력 시 자동으로 층수(F1/B1)와 TR(A/B/C/D) 추출 (형식: 1, 2, 1-1, 2-1, 3-1-1)
      if (field === 'id' && value) {
        const idParts = value.trim().split('-').map((p: string) => p.trim());
        if (idParts.length === 1 && idParts[0]) {
          // 1 또는 2 → 층만
          const floorFromId = NUM_TO_FLOOR[idParts[0]] || (idParts[0] === '1' ? 'F1' : idParts[0] === '7' ? 'B1' : '');
          if (floorFromId && (!updated.floor || updated.floor !== floorFromId)) {
            updated.floor = floorFromId;
            if (floorFromId === 'F1' || floorFromId === 'B1') {
              setSelectedFloor(floorFromId as 'F1' | 'B1');
            }
          }
        } else if (idParts.length >= 2) {
          const floorFromId = NUM_TO_FLOOR[idParts[0]] || (idParts[0] === '1' ? 'F1' : idParts[0] === '7' ? 'B1' : '');
          const locationFromId = NUM_TO_TR[idParts[1]] || idParts[1];
          if (floorFromId && (!updated.floor || updated.floor !== floorFromId)) {
            updated.floor = floorFromId;
            if (floorFromId === 'F1' || floorFromId === 'B1') {
              setSelectedFloor(floorFromId as 'F1' | 'B1');
            }
          }
          if (locationFromId && isValidTR(locationFromId.toUpperCase()) && (!updated.location || updated.location !== locationFromId.toUpperCase())) {
            updated.location = locationFromId.toUpperCase();
          }
        }
      }
      
      // 층수 필드 변경 시 selectedFloor도 동기화
      if (field === 'floor' && (value === 'F1' || value === 'B1')) {
        setSelectedFloor(value as 'F1' | 'B1');
      }
      
      // 층수와 위치가 모두 입력되면 자동으로 QR 생성 (선택된 QR 편집 중일 때는 제외 → 층수 선택이 F1으로 되돌아가는 것 방지)
      const hasFloor = updated.floor && (updated.floor === 'F1' || updated.floor === 'B1');
      const hasLocation = updated.location && updated.location.trim() !== '';
      
      if (hasFloor && hasLocation && !selectedQR) {
        // PNL NO.가 없으면 자동 생성: 1-1, 2-1 형식 (F1/B1 + A/B/C/D)
        if (!updated.id || updated.id.trim() === '') {
          updated.id = toPnlNo(updated.floor, updated.location);
        }
        
        // 중복 체크: 같은 층수에서 TR(위치) 중복 확인
        const savedQRCodes = qrCodes;
        const sameFloorQRCodes = savedQRCodes.filter((qr: QRCodeData) => qr.floor === updated.floor);
        if (isValidTR(updated.location)) {
          // TR(A/B/C/D): 같은 층+같은 TR이면 중복
          const duplicateQR = sameFloorQRCodes.find((qr: QRCodeData) => {
            try {
              const parsed = JSON.parse(qr.qrData);
              const loc = (parsed.location || qr.location || '').toString().trim().toUpperCase();
              return loc === updated.location.toUpperCase();
            } catch {
              return (qr.location || '').toString().trim().toUpperCase() === updated.location.toUpperCase();
            }
          });
          if (duplicateQR) {
            setTimeout(() => alert(`같은 층수(${updated.floor})에 TR ${updated.location}(이)가 이미 등록되어 있습니다. 다른 TR을 선택해 주세요.`), 0);
            return prev; // 중복 시 저장하지 않음
          }
        } else {
          const locationNum = parseInt(updated.location);
          if (!isNaN(locationNum)) {
            const duplicateQR = sameFloorQRCodes.find((qr: QRCodeData) => {
              try {
                const qrData = JSON.parse(qr.qrData);
                const qrLocationNum = parseInt(qrData.location || qr.location);
                return !isNaN(qrLocationNum) && qrLocationNum === locationNum;
              } catch {
                return false;
              }
            });
            if (duplicateQR) {
              const locationNumbers = sameFloorQRCodes.map((qr: QRCodeData) => {
                try {
                  const qrData = JSON.parse(qr.qrData);
                  const num = parseInt(qrData.location || qr.location);
                  return isNaN(num) ? 0 : num;
                } catch {
                  return 0;
                }
              }).filter(n => n > 0);
              const maxLocationNum = locationNumbers.length > 0 ? Math.max(...locationNumbers) : 0;
              updated.location = String(maxLocationNum + 1).padStart(3, '0');
              updated.id = toPnlNo(updated.floor, updated.location);
            }
          }
        }
        
        // 자동으로 QR 생성
        setTimeout(() => {
          autoGenerateQR(updated);
        }, 100);
      }
      
      return updated;
    });
  };

  // 자동 QR 생성 함수
  const autoGenerateQR = (data: QRData) => {
    if (!data.location || !data.floor) {
      return;
    }

    // Position coordinates (optional)
    const position = {
      description: '',
      x: data.positionX ? parseFloat(data.positionX) : undefined,
      y: data.positionY ? parseFloat(data.positionY) : undefined
    };

    // PNL NO. 생성: 1-1, 2-1 형식 (F1/B1 + A/B/C/D)
    const finalId = data.id?.trim() || (isValidTR(data.location) ? toPnlNo(data.floor, data.location) : `${FLOOR_TO_NUM[data.floor] || data.floor}-${data.location}`);

    // QR 코드에 포함될 데이터를 JSON 형식으로 생성
    const qrDataString = JSON.stringify({
      id: finalId,
      location: data.location,
      floor: data.floor,
      position: position,
      timestamp: new Date().toISOString()
    });

    // 기존 QR 코드 확인
    const savedQRCodes = qrCodes;
    const existingQR = savedQRCodes.find((qr: QRCodeData) => {
      try {
        const qrData = JSON.parse(qr.qrData);
        return qrData.id === finalId;
      } catch {
        return false;
      }
    });

    if (!existingQR) {
      // 새 QR 코드 생성
      const newQRCode: QRCodeData = {
        id: `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        qrData: qrDataString,
        location: data.location,
        floor: data.floor,
        position: data.position || '',
        createdAt: new Date().toISOString()
      };

      const updatedQRCodes = [...savedQRCodes, newQRCode];
      setQrCodes(updatedQRCodes);
      setGeneratedQR(qrDataString);
      setSavedQRId(newQRCode.id);
      
      // QR 코드 선택
      setSelectedQR(newQRCode);
    } else {
      // 기존 QR 코드 업데이트
      setGeneratedQR(qrDataString);
      setSelectedQR(existingQR);
    }
  };

  const handleSelectQR = (qr: QRCodeData) => {
    setSelectedQR(qr);
    try {
      const data = JSON.parse(qr.qrData);
      const position = data.position || {};
      setQrData({
        id: data.id || '',
        location: qr.location,
        floor: qr.floor,
        position: typeof position === 'string' ? position : (position.description || qr.position || ''),
        positionX: position.x ? String(position.x) : '',
        positionY: position.y ? String(position.y) : ''
      });
      // generatedQR은 설정하지 않음 - 상세 정보 섹션에서 표시
      // setGeneratedQR(qr.qrData);
      setIsEditing(false);
    } catch (e) {
      setQrData({
        id: '',
        location: qr.location,
        floor: qr.floor,
        position: qr.position,
        positionX: '',
        positionY: ''
      });
      // generatedQR은 설정하지 않음 - 상세 정보 섹션에서 표시
      // setGeneratedQR(qr.qrData);
      setIsEditing(false);
    }
  };

  const findOrCreateInspection = (qr: QRCodeData, qrData: any, position: any) => {
    if (!onSelectInspection || !onUpdateInspections) return;

    // 위치 정보를 기반으로 InspectionRecord 찾기
    // 1. 위치 정보가 일치하는 것 찾기
    let foundInspection: InspectionRecord | undefined;
    
    if (position.x !== undefined && position.y !== undefined) {
      // 좌표 기반으로 찾기 (5% 오차 허용)
      foundInspection = inspections.find(inspection => {
        if (!inspection.position) return false;
        const dx = Math.abs(inspection.position.x - position.x);
        const dy = Math.abs(inspection.position.y - position.y);
        return dx < 5 && dy < 5;
      });
    }

    // 2. 위치 이름으로 찾기 (예: "1 1 1" 같은 값)
    if (!foundInspection) {
      const locationParts = qr.location.split(/\s+/);
      foundInspection = inspections.find(inspection => {
        const idParts = inspection.panelNo.split('-');
        if (idParts.length >= 3) {
          // DB-층수-위치 형식에서 위치는 idParts[2]
          return locationParts.some(part => idParts[2].includes(part) || part.includes(idParts[2]));
        } else if (idParts.length >= 2) {
          // 호환성을 위해 2개 파트만 있는 경우
          return locationParts.some(part => idParts[1].includes(part) || part.includes(idParts[1]));
        }
        return false;
      });
    }

    if (foundInspection) {
      onSelectInspection(foundInspection.panelNo);
    } else {
      const positionObj = position.x !== undefined && position.y !== undefined 
        ? { x: position.x, y: position.y }
        : undefined;
      const newPanelNo = isValidTR(qr.location) ? toPnlNo(qr.floor, qr.location) : `${FLOOR_TO_NUM[qr.floor] || qr.floor}-${qr.location}`;

      const newInspection: InspectionRecord = {
        panelNo: newPanelNo,
        status: 'Pending',
        lastInspectionDate: '-',
        loads: { welder: false, grinder: false, light: false, pump: false },
        photoUrl: null,
        memo: `QR 코드로 생성됨\n위치: ${qr.location}\n층수: ${qr.floor}\n위치 정보: ${qr.position}`,
        position: positionObj
      };

      // 새 Inspection 추가
      const updatedInspections = [newInspection, ...inspections];
      onUpdateInspections(updatedInspections);
      
      // 새로 생성된 Inspection 선택
      onSelectInspection(newId);
    }
  };

  const handleEditQR = (qr: QRCodeData, e: React.MouseEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).blur();
    const savedRightScroll = rightPanelScrollRef.current?.scrollTop ?? 0;
    const savedMainScroll = mainScrollRef?.current?.scrollTop ?? 0;
    setSelectedQR(qr);
    setIsEditing(true);
    setShowForm(true);
    try {
      const data = JSON.parse(qr.qrData);
      const position = data.position || {};
      setQrData({
        id: data.id || '',
        location: qr.location,
        floor: qr.floor,
        position: typeof position === 'string' ? position : (position.description || qr.position || ''),
        positionX: position.x ? String(position.x) : '',
        positionY: position.y ? String(position.y) : ''
      });
      setGeneratedQR(qr.qrData);
    } catch (e) {
      setQrData({
        id: '',
        location: qr.location,
        floor: qr.floor,
        position: qr.position,
        positionX: '',
        positionY: ''
      });
      setGeneratedQR(qr.qrData);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (rightPanelScrollRef.current) {
          rightPanelScrollRef.current.scrollTop = savedRightScroll;
        }
        if (mainScrollRef?.current) {
          mainScrollRef.current.scrollTop = savedMainScroll;
        }
      });
    });
  };

  const handleUpdateQR = () => {
    if (!selectedQR || !qrData.location || !qrData.floor) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    // 중복 체크: 같은 층수에서 TR(위치) 중복 확인
    const savedQRCodes = qrCodes;
    const sameFloorQRCodes = savedQRCodes.filter((qr: QRCodeData) => {
      return qr.floor === qrData.floor && qr.id !== selectedQR.id;
    });

    let finalLocation = qrData.location;
    let locationChanged = false;
    const originalLocation = qrData.location;

    if (isValidTR(qrData.location)) {
      const duplicateQR = sameFloorQRCodes.find((qr: QRCodeData) => {
        try {
          const parsed = JSON.parse(qr.qrData);
          const loc = (parsed.location || qr.location || '').toString().trim().toUpperCase();
          return loc === qrData.location.toUpperCase();
        } catch {
          return (qr.location || '').toString().trim().toUpperCase() === qrData.location.toUpperCase();
        }
      });
      if (duplicateQR) {
        alert(`같은 층수(${qrData.floor})에 TR ${originalLocation}(이)가 이미 등록되어 있습니다. 다른 TR(A/B/C/D)을 선택해 주세요.`);
        return;
      }
    } else {
      const locationNum = parseInt(qrData.location);
      if (!isNaN(locationNum)) {
        const duplicateQR = sameFloorQRCodes.find((qr: QRCodeData) => {
          try {
            const parsed = JSON.parse(qr.qrData);
            const qrLocationNum = parseInt(parsed.location || qr.location);
            return !isNaN(qrLocationNum) && qrLocationNum === locationNum;
          } catch {
            return false;
          }
        });
        if (duplicateQR) {
          const locationNumbers = sameFloorQRCodes.map((qr: QRCodeData) => {
            try {
              const parsed = JSON.parse(qr.qrData);
              const num = parseInt(parsed.location || qr.location);
              return isNaN(num) ? 0 : num;
            } catch {
              return 0;
            }
          }).filter(n => n > 0);
          let nextLocationNum = 1;
          if (locationNumbers.length > 0) {
            const maxLocationNum = Math.max(...locationNumbers);
            const sortedNumbers = [...new Set(locationNumbers)].sort((a, b) => a - b);
            for (let i = 1; i <= maxLocationNum + 1; i++) {
              if (!sortedNumbers.includes(i)) {
                nextLocationNum = i;
                break;
              }
            }
            if (nextLocationNum === 1 && sortedNumbers.includes(1)) {
              nextLocationNum = maxLocationNum + 1;
            }
          }
          finalLocation = String(nextLocationNum).padStart(3, '0');
          locationChanged = true;
          alert(`같은 층수(${qrData.floor})에 위치 번호 ${originalLocation}이(가) 이미 존재합니다.\n위치 번호가 ${finalLocation}로 자동 변경되었습니다.`);
        }
      }
    }

    const position = {
      description: '',
      x: qrData.positionX ? parseFloat(qrData.positionX) : undefined,
      y: qrData.positionY ? parseFloat(qrData.positionY) : undefined
    };

    // 위치가 변경되었으면 qrData 업데이트
    let finalId = qrData.id;
    if (locationChanged) {
      finalId = isValidTR(finalLocation) ? toPnlNo(qrData.floor, finalLocation) : `${FLOOR_TO_NUM[qrData.floor] || qrData.floor}-${finalLocation}`;
      setQrData(prev => ({
        ...prev,
        location: finalLocation,
        id: finalId
      }));
    } else {
      finalId = qrData.id?.trim() || (isValidTR(finalLocation) ? toPnlNo(qrData.floor, finalLocation) : `${FLOOR_TO_NUM[qrData.floor] || qrData.floor}-${finalLocation}`);
    }
    const updatedQRData = JSON.stringify({
      id: finalId,
      location: finalLocation,
      floor: qrData.floor,
      position: position,
      timestamp: new Date().toISOString()
    });

    const updatedQRCodes = qrCodes.map(qr => 
      qr.id === selectedQR.id 
        ? {
            ...qr,
            location: finalLocation,
            floor: qrData.floor,
            position: qrData.position,
            qrData: updatedQRData
          }
        : qr
    );

    setQrCodes(updatedQRCodes);
    setGeneratedQR(updatedQRData);
    setIsEditing(false);
    const updatedQR = updatedQRCodes.find((qr: QRCodeData) => qr.id === selectedQR.id);
    if (updatedQR) {
      setSelectedQR(updatedQR);
      // 저장된 QR로 폼(qrData) 동기화 → 입력값이 바로 반영되도록
      try {
        const data = JSON.parse(updatedQR.qrData);
        const position = data.position || {};
        setQrData({
          id: data.id || '',
          location: updatedQR.location,
          floor: updatedQR.floor,
          position: typeof position === 'string' ? position : (position.description || updatedQR.position || ''),
          positionX: position.x != null ? String(position.x) : '',
          positionY: position.y != null ? String(position.y) : ''
        });
      } catch {
        setQrData(prev => ({
          ...prev,
          location: updatedQR.location,
          floor: updatedQR.floor
        }));
      }
    }
    alert('QR 코드가 수정되었습니다.');
    // 수정된 QR 코드를 기반으로 InspectionRecord 업데이트
    if (onUpdateInspections) {
      registerAllQRCodesAsInspections();
    }
    // alert/리렌더 후 스크롤 복원 (여러 시점에 복원)
    restoreScrollAfterAction();
  };

  const handleDeleteQR = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('이 QR 코드를 삭제하시겠습니까?')) {
      const updated = qrCodes.filter(qr => qr.id !== id);
      setQrCodes(updated);
      if (selectedQR?.id === id) {
        setSelectedQR(null);
        setGeneratedQR(null);
        setQrData({ id: 'A', location: 'A', floor: 'F1', position: '', positionX: '', positionY: '' });
        setIsEditing(false);
      }
    }
  };

  const handleMapToDashboard = () => {
    let qrDataToUse: any = null;
    // selectedQR 또는 generatedQR에서 데이터 가져오기
    if (selectedQR) {
      try {
        qrDataToUse = JSON.parse(selectedQR.qrData);
      } catch (e) {
        console.error('Failed to parse selectedQR data:', e);
        return;
      }
    } else if (generatedQR) {
      try {
        qrDataToUse = JSON.parse(generatedQR);
      } catch (e) {
        console.error('Failed to parse generatedQR data:', e);
        return;
      }
    } else {
      return;
    }
    
    // 상세 패널(모달) 표시 후 해당 마커 선택 → 위치 수정 가능
    if (qrDataToUse.id && onSelectInspection) {
      setOpenDetailPanelForMapping(true);
      onSelectInspection(qrDataToUse.id);
    }
    // 리렌더 후 스크롤 복원
    restoreScrollAfterAction();
  };

  const saveQRCode = (qrDataString: string): QRCodeData => {
    const qrDataObj = JSON.parse(qrDataString);
    const newQRCode: QRCodeData = {
      id: `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      location: qrDataObj.location || qrData.location,
      floor: qrDataObj.floor || qrData.floor,
      position: qrData.position,
      qrData: qrDataString,
      createdAt: new Date().toISOString()
    };
    setQrCodes(prev => [newQRCode, ...prev]);
    return newQRCode;
  };

  const generateQR = () => {
    // ID 기반으로 위치, 층수 정보 자동 설정
    let finalLocation = qrData.location;
    let finalFloor = qrData.floor;
    
    if (qrData.id && (!finalLocation || !finalFloor)) {
      // PNL NO.에서 층·TR 추출 (형식: 1, 2, 1-1, 2-1, 3-1-1)
      const idParts = qrData.id.trim().split('-').map((p: string) => p.trim());
      if (idParts.length === 1 && idParts[0]) {
        if (!finalFloor) finalFloor = NUM_TO_FLOOR[idParts[0]] || (idParts[0] === '1' ? 'F1' : idParts[0] === '7' ? 'B1' : '');
      } else if (idParts.length >= 2) {
        if (!finalFloor) finalFloor = NUM_TO_FLOOR[idParts[0]] || (idParts[0] === '1' ? 'F1' : idParts[0] === '7' ? 'B1' : '');
        if (!finalLocation) finalLocation = NUM_TO_TR[idParts[1]] || idParts[1];
      }
      if (!finalFloor) finalFloor = 'F1';
      if (!finalLocation && isValidTR('A')) finalLocation = 'A';
    }

    if (!finalLocation || !finalFloor) {
      alert('PNL NO., 층수를 모두 입력해주세요.');
      return;
    }

    // 중복 체크: 같은 층수에서 TR(위치) 중복 확인
    const savedQRCodes = qrCodes;
    const sameFloorQRCodes = savedQRCodes.filter((qr: QRCodeData) => qr.floor === finalFloor);

    let locationChanged = false;
    const originalLocation = finalLocation;

    if (isValidTR(finalLocation)) {
      const duplicateQR = sameFloorQRCodes.find((qr: QRCodeData) => {
        if (isEditing && selectedQR && qr.id === selectedQR.id) return false;
        try {
          const parsed = JSON.parse(qr.qrData);
          const loc = (parsed.location || qr.location || '').toString().trim().toUpperCase();
          return loc === finalLocation.toUpperCase();
        } catch {
          return (qr.location || '').toString().trim().toUpperCase() === finalLocation.toUpperCase();
        }
      });
      if (duplicateQR) {
        alert(`같은 층수(${finalFloor})에 TR ${originalLocation}(이)가 이미 등록되어 있습니다. 다른 TR(A/B/C/D)을 선택해 주세요.`);
        return;
      }
    } else {
      const locationNum = parseInt(finalLocation);
      if (!isNaN(locationNum)) {
        const duplicateQR = sameFloorQRCodes.find((qr: QRCodeData) => {
          if (isEditing && selectedQR && qr.id === selectedQR.id) return false;
          try {
            const parsed = JSON.parse(qr.qrData);
            const qrLocationNum = parseInt(parsed.location || qr.location);
            return !isNaN(qrLocationNum) && qrLocationNum === locationNum;
          } catch {
            return false;
          }
        });
        if (duplicateQR) {
          const locationNumbers = sameFloorQRCodes.map((qr: QRCodeData) => {
            try {
              const parsed = JSON.parse(qr.qrData);
              const num = parseInt(parsed.location || qr.location);
              return isNaN(num) ? 0 : num;
            } catch {
              return 0;
            }
          }).filter(n => n > 0);
          let nextLocationNum = 1;
          if (locationNumbers.length > 0) {
            const maxLocationNum = Math.max(...locationNumbers);
            const sortedNumbers = [...new Set(locationNumbers)].sort((a, b) => a - b);
            for (let i = 1; i <= maxLocationNum + 1; i++) {
              if (!sortedNumbers.includes(i)) {
                nextLocationNum = i;
                break;
              }
            }
            if (nextLocationNum === 1 && sortedNumbers.includes(1)) {
              nextLocationNum = maxLocationNum + 1;
            }
          }
          finalLocation = String(nextLocationNum).padStart(3, '0');
          locationChanged = true;
          alert(`같은 층수(${finalFloor})에 위치 번호 ${originalLocation}이(가) 이미 존재합니다.\n위치 번호가 ${finalLocation}로 자동 변경되었습니다.`);
        }
      }
    }

    // Position coordinates (optional)
    const position = {
      description: '',
      x: qrData.positionX ? parseFloat(qrData.positionX) : undefined,
      y: qrData.positionY ? parseFloat(qrData.positionY) : undefined
    };

    // 위치가 변경되었으면 qrData 업데이트
    let finalId = qrData.id;
    if (locationChanged) {
      finalId = isValidTR(finalLocation) ? toPnlNo(finalFloor, finalLocation) : `${FLOOR_TO_NUM[finalFloor] || finalFloor}-${finalLocation}`;
      setQrData(prev => ({
        ...prev,
        location: finalLocation,
        id: finalId
      }));
    } else {
      finalId = qrData.id?.trim() || (isValidTR(finalLocation) ? toPnlNo(finalFloor, finalLocation) : `${FLOOR_TO_NUM[finalFloor] || finalFloor}-${finalLocation}`);
    }

    // QR 코드에 포함될 데이터를 JSON 형식으로 생성
    const data = JSON.stringify({
      id: finalId,
      location: finalLocation,
      floor: finalFloor,
      position: position,
      timestamp: new Date().toISOString()
    });

    setGeneratedQR(data);
    
    if (isEditing && selectedQR) {
      // 수정 모드
      handleUpdateQR();
      return;
    }
    
    // QR 코드와 위치 정보 저장
    const newQR = saveQRCode(data);
    setSavedQRId(newQR.id);
    setSelectedQR(newQR);
    
    // 성공 메시지
    setShowForm(false);
    setShowCreateModal(false);
    setTimeout(() => {
      alert('QR 코드와 위치 정보가 저장되었습니다!');
    }, 100);
  };

  const handlePrint = () => {
    if (!generatedQR) return;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const data = JSON.parse(generatedQR);
      
      // QR 코드 SVG를 가져오기
      const svgElement = document.querySelector('#qr-code-svg');
      const svgHTML = svgElement ? svgElement.outerHTML : '';

      const htmlContent = `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QR Code - ${data.location}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', sans-serif;
      padding: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: white;
    }
    .qr-container {
      text-align: center;
      padding: 40px;
      border: 2px solid #1e293b;
      border-radius: 12px;
      background: white;
      max-width: 600px;
    }
    .qr-title {
      font-size: 24px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 20px;
    }
    .qr-code-wrapper {
      display: flex;
      justify-content: center;
      margin: 30px 0;
      padding: 20px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .qr-code-wrapper svg {
      max-width: 100%;
      height: auto;
    }
    .qr-info {
      margin-top: 30px;
      text-align: left;
    }
    .info-item {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: #f1f5f9;
      border-radius: 8px;
    }
    .info-label {
      font-weight: 600;
      color: #475569;
      min-width: 100px;
    }
    .info-value {
      color: #1e293b;
      font-size: 16px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 12px;
    }
    @media print {
      body {
        padding: 20px;
      }
      .qr-container {
        border: 1px solid #1e293b;
      }
    }
  </style>
</head>
<body>
  <div class="qr-container">
    <h1 class="qr-title">Distribution Board QR Code</h1>
    <div class="qr-code-wrapper">
      ${svgHTML}
    </div>
    <div class="qr-info">
      <div class="info-item">
        <span class="info-label">TR:</span>
        <span class="info-value">${data.location}</span>
      </div>
      <div class="info-item">
        <span class="info-label">층수:</span>
        <span class="info-value">${data.floor}</span>
      </div>
      <div class="info-item">
        <span class="info-label">위치 정보:</span>
        <span class="info-value">${data.position}</span>
      </div>
    </div>
    <div class="footer">
      <p>성수동 K-PJT - QR Code Generated</p>
      <p style="margin-top: 4px;">${new Date().toLocaleString('ko-KR')}</p>
    </div>
  </div>
</body>
</html>
      `;
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      
      // 인쇄 대화상자 열기
      setTimeout(() => {
        printWindow.print();
      }, 500);
    }
  };

  const handleDownload = () => {
    if (!generatedQR) return;

    const data = JSON.parse(generatedQR);
    const svgElement = document.querySelector('#qr-code-svg') as SVGSVGElement;
    
    if (svgElement) {
      // SVG를 이미지로 변환
      const svgData = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              const downloadUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = downloadUrl;
              link.download = `QR_${data.location}_${data.floor}_${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(downloadUrl);
            }
          }, 'image/png');
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  };

  const resetForm = () => {
    setQrData({
      id: 'A',
      location: 'A',
      floor: 'F1',
      position: '',
      positionX: '',
      positionY: ''
    });
    setGeneratedQR(null);
    setSelectedQR(null);
    setIsEditing(false);
    setShowForm(false);
    setShowCreateModal(false);
    setShowQRModal(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // QR 코드와 InspectionRecord 매칭 여부 확인 함수
  const isInspectionMatchedWithQR = useCallback((inspection: InspectionRecord, qr: QRCodeData): boolean => {
    try {
      const qrData = JSON.parse(qr.qrData);
      const position = qrData.position || {};
      if (inspection.position && position.x !== undefined && position.y !== undefined) {
        const dx = Math.abs(inspection.position.x - position.x);
        const dy = Math.abs(inspection.position.y - position.y);
        return dx < 5 && dy < 5;
      }
      return false;
    } catch (e) {
      return false;
    }
  }, []);

  // QR 코드와 매칭되지 않은 InspectionRecord 목록
  const unmatchedInspections = useMemo(() => {
    return inspections.filter(i => !qrCodes.some(qr => isInspectionMatchedWithQR(i, qr)));
  }, [inspections, qrCodes, isInspectionMatchedWithQR]);

  // QR 코드 매핑 최적화 (성능 개선)
  const qrCodeMap = useMemo(() => {
    const map = new Map<string, QRCodeData>();
    qrCodes.forEach(qr => {
      try {
        const qrData = JSON.parse(qr.qrData);
        if (qrData.id) {
          map.set(qrData.id, qr);
        }
      } catch (e) {
        // 무시
      }
    });
    return map;
  }, [qrCodes]);

  // 선택된 QR의 ID 추출 최적화
  const selectedQRId = useMemo(() => {
    if (selectedQR) {
      try {
        const qrData = JSON.parse(selectedQR.qrData);
        return qrData.id || '';
      } catch (e) {
        return '';
      }
    }
    return '';
  }, [selectedQR]);

  // #region agent log
  React.useEffect(() => {
    if (showForm) {
      // 비동기 처리로 성능 개선
      requestIdleCallback(() => {
        const selects = document.querySelectorAll('select');
        selects.forEach((select, idx) => {
          const computed = window.getComputedStyle(select);
          const parent = select.parentElement as HTMLElement;
          fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:973',message:'select element mounted in form',data:{index:idx,id:select.id,className:select.className,value:(select as HTMLSelectElement).value,pointerEvents:computed.pointerEvents,zIndex:computed.zIndex,position:computed.position,display:computed.display,visibility:computed.visibility,isDisabled:(select as HTMLSelectElement).disabled,parentOverflow:window.getComputedStyle(parent).overflow,parentZIndex:window.getComputedStyle(parent).zIndex,parentPosition:window.getComputedStyle(parent).position,showForm},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        });
      }, { timeout: 1000 });
    }
  }, [showForm, qrData.floor, selectedFloor]);
  // #endregion

  // Select 포커스 시 모든 부모 컨테이너의 overflow를 visible로 변경
  React.useEffect(() => {
    if (isSelectFocused) {
      const selectElement = document.querySelector('select:focus') as HTMLSelectElement;
      if (selectElement) {
        // 모든 부모 요소를 찾아서 overflow를 visible로 변경
        let parent: HTMLElement | null = selectElement.parentElement;
        const originalOverflows: Array<{ element: HTMLElement; overflow: string; overflowX: string; overflowY: string }> = [];
        
        while (parent && parent !== document.body) {
          const computed = window.getComputedStyle(parent);
          const overflow = computed.overflow;
          const overflowX = computed.overflowX;
          const overflowY = computed.overflowY;
          
          // #region agent log
          // 비동기 처리로 성능 개선
          requestIdleCallback(() => {
            fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:993',message:'checking parent overflow',data:{parentTag:parent.tagName,parentClass:parent.className,overflow,overflowX,overflowY,willChange:overflow !== 'visible' && overflow !== 'unset'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          }, { timeout: 1000 });
          // #endregion
          
          if (overflow !== 'visible' && overflow !== 'unset') {
            originalOverflows.push({ element: parent, overflow, overflowX, overflowY });
            (parent as HTMLElement).style.overflow = 'visible';
            (parent as HTMLElement).style.overflowX = 'visible';
            (parent as HTMLElement).style.overflowY = 'visible';
            
            // #region agent log
            // 비동기 처리로 성능 개선
            requestIdleCallback(() => {
              fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:1005',message:'changed parent overflow to visible',data:{parentTag:parent.tagName,parentClass:parent.className,originalOverflow:overflow,originalOverflowX:overflowX,originalOverflowY:overflowY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            }, { timeout: 1000 });
            // #endregion
          }
          parent = parent.parentElement;
        }

        // cleanup 함수: blur 시 원래 overflow로 복원
        return () => {
          originalOverflows.forEach(({ element, overflow, overflowX, overflowY }) => {
            element.style.overflow = overflow;
            element.style.overflowX = overflowX;
            element.style.overflowY = overflowY;
            
            // #region agent log
            // 비동기 처리로 성능 개선
            requestIdleCallback(() => {
              fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:1015',message:'restored parent overflow',data:{parentTag:element.tagName,parentClass:element.className,restoredOverflow:overflow,restoredOverflowX:overflowX,restoredOverflowY:overflowY},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            }, { timeout: 1000 });
            // #endregion
          });
        };
      }
    }
  }, [isSelectFocused]);

  return (
    <div className="h-full flex bg-slate-50" style={{ overflow: isSelectFocused ? 'visible' : 'hidden' }}>
      {/* Left Panel: QR List */}
      <div className="w-1/3 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">등록된 분전함</h2>
          <p className="text-sm text-slate-600">{inspections.length}개</p>
        </div>
        
        {inspections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
            <QrCode size={48} className="mb-4 opacity-50" />
            <p className="text-sm text-center">등록된 분전함이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {inspections
              .filter((inspection, index, self) => 
                index === self.findIndex(i => i.panelNo === inspection.panelNo)
              )
              .map((inspection, index) => {
              const matchingQR = qrCodeMap.get(inspection.panelNo);
              const isSelected = selectedQRId === inspection.panelNo;
              
              return (
                <div
                  key={`${inspection.panelNo}-${index}`}
                  data-inspection-id={inspection.panelNo}
                  data-selected={isSelected ? 'true' : 'false'}
                  onClick={(e) => {
                    (e.currentTarget as HTMLElement).blur();
                    const rightScroll = rightPanelScrollRef.current?.scrollTop ?? 0;
                    const mainScroll = mainScrollRef?.current?.scrollTop ?? 0;
                    if (matchingQR) {
                      handleSelectQR(matchingQR);
                    } else {
                      setSelectedQR(null);
                      setQrData({
                        id: inspection.panelNo,
                        location: 'A',
                        floor: 'F1',
                        position: '',
                        positionX: inspection.position?.x?.toString() || '',
                        positionY: inspection.position?.y?.toString() || ''
                      });
                    }
                    if (onSelectInspection) {
                      onSelectInspection(inspection.panelNo);
                    }
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        if (rightPanelScrollRef.current) {
                          rightPanelScrollRef.current.scrollTop = rightScroll;
                        }
                        if (mainScrollRef?.current) {
                          mainScrollRef.current.scrollTop = mainScroll;
                        }
                      });
                    });
                  }}
                  className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 ${
                    isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <MapPin size={14} className="text-blue-600" />
                        <span className="font-semibold text-slate-800">
                          {migrateIdFloor(inspection.panelNo)}
                        </span>
                      </div>
                      {matchingQR && (
                        <>
                          <p className="text-sm text-slate-600 mb-1">{floorToDisplayLabel(matchingQR.floor)}</p>
                          <p className="text-xs text-slate-500 line-clamp-1">{matchingQR.location}</p>
                          <div className="flex items-center gap-1 mt-2 text-xs text-slate-400">
                            <Calendar size={12} />
                            <span>{formatDate(matchingQR.createdAt)}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {matchingQR && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditQR(matchingQR, e);
                          }}
                          className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                          title="Edit QR code"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteQR(matchingQR.id, e);
                          }}
                          className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete QR code"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right Panel: QR Generator & Details */}
      <div
        ref={rightPanelScrollRef}
        className="flex-1 overflow-y-auto"
        style={{ overflowX: 'visible', overflowY: isSelectFocused ? 'visible' : 'auto', position: 'relative' }}
      >
        <div
          className="max-w-4xl mx-auto p-6 space-y-6"
          style={{ overflow: isSelectFocused ? 'visible' : undefined, position: 'relative' }}
          onMouseDown={() => {
            savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
            savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
          }}
        >
          {/* Header */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <QrCode size={24} className="text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-slate-800">QR Code Generator</h1>
                  <p className="text-sm text-slate-600 mt-1">Distribution Board QR Code 생성</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowCreateModal(true);
                  setShowForm(true);
                  resetForm();
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
              >
                <QrCode size={20} />
                QR 코드 신규 등록
              </button>
            </div>
          </div>

        {/* Input Form Modal */}
        {showCreateModal && showForm && createPortal(
          <React.Fragment>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-50"
              onClick={() => {
                setShowCreateModal(false);
                setShowForm(false);
                resetForm();
              }}
            />
            {/* Modal */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div 
                className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6" style={{ overflow: 'visible', position: 'relative', zIndex: 1 }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800">QR 코드 신규 등록</h2>
                    <button
                      onClick={() => {
                        setShowCreateModal(false);
                        setShowForm(false);
                        resetForm();
                      }}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                      title="닫기"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  
                  <div className="space-y-4" style={{ overflow: 'visible', position: 'relative' }}>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <FileText size={16} />
                        PNL NO.
                      </label>
                      <input
                        type="text"
                        value={qrData.id}
                        onChange={(e) => handleInputChange('id', e.target.value)}
                        placeholder="예: 1-1 또는 2-1"
                        className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      />
                    </div>

                    <div style={{ overflow: 'visible', position: 'relative', zIndex: 1 }}>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <Building2 size={16} />
                        층수
                      </label>
                      <select
                        value={qrData.floor || selectedFloor}
                        onFocus={() => {
                          setIsSelectFocused(true);
                          // #region agent log
                          // 비동기 처리로 성능 개선
                          requestIdleCallback(() => {
                            fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:1257',message:'floor select onFocus event fired',data:{isSelectFocused:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                          }, { timeout: 1000 });
                          // #endregion
                        }}
                        onBlur={() => {
                          // 약간의 지연을 두어 드롭다운 선택이 완료되도록 함
                          setTimeout(() => setIsSelectFocused(false), 200);
                          // #region agent log
                          // 비동기 처리로 성능 개선
                          requestIdleCallback(() => {
                            fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:1263',message:'floor select onBlur event fired',data:{isSelectFocused:false},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                          }, { timeout: 1000 });
                          // #endregion
                        }}
                        onChange={(e) => {
                          // #region agent log
                          // 비동기 처리로 성능 개선 - getComputedStyle 호출도 지연
                          requestIdleCallback(() => {
                            const target = e.target as HTMLSelectElement;
                            const computed = window.getComputedStyle(target);
                            fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:1241',message:'floor select onChange event fired',data:{oldValue:qrData.floor || selectedFloor,newValue:e.target.value,selectComputedStyle:computed.pointerEvents,selectZIndex:computed.zIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                          }, { timeout: 1000 });
                          // #endregion
                          handleInputChange('floor', e.target.value);
                          setSelectedFloor(e.target.value as 'F1' | 'B1');
                        }}
                        onClick={(e) => {
                          // #region agent log
                          // 비동기 처리로 성능 개선 - getComputedStyle 호출도 지연
                          requestIdleCallback(() => {
                            const target = e.target as HTMLSelectElement;
                            const computed = window.getComputedStyle(target);
                            const parent = target.parentElement as HTMLElement;
                            const parentComputed = parent ? window.getComputedStyle(parent) : null;
                            fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'QRGenerator.tsx:1246',message:'floor select onClick event fired',data:{pointerEvents:computed.pointerEvents,zIndex:computed.zIndex,position:computed.position,display:computed.display,visibility:computed.visibility,isDisabled:target.disabled,parentZIndex:parentComputed?.zIndex || 'auto'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                          }, { timeout: 1000 });
                          // #endregion
                        }}
                        className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all cursor-pointer bg-white"
                        style={{ pointerEvents: 'auto', zIndex: 'auto', position: 'relative', WebkitAppearance: 'menulist', appearance: 'menulist' } as React.CSSProperties}
                      >
                        <option value="F1">F1</option>
                        <option value="B1">B1</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                        <MapPin size={16} />
                        TR
                      </label>
                      <select
                        value={isValidTR(qrData.location) ? qrData.location : 'A'}
                        onChange={(e) => handleInputChange('location', e.target.value)}
                        className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white cursor-pointer"
                      >
                        {TR_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          X 좌표 (0-100%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={qrData.positionX}
                          onChange={(e) => handleInputChange('positionX', e.target.value)}
                          placeholder="예: 25"
                          className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                        />
                        <p className="text-xs text-slate-500 mt-1">Dashboard 위치 매핑용 (선택사항)</p>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                          Y 좌표 (0-100%)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={qrData.positionY}
                          onChange={(e) => handleInputChange('positionY', e.target.value)}
                          placeholder="예: 30"
                          className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                        />
                        <p className="text-xs text-slate-500 mt-1">Dashboard 위치 매핑용 (선택사항)</p>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={generateQR}
                        disabled={!qrData.location || !qrData.floor}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <QrCode size={18} />
                        {isEditing ? 'QR 코드 수정' : 'QR 코드 생성'}
                      </button>
                      {(generatedQR || isEditing) && (
                        <button
                          onClick={resetForm}
                          className="px-6 py-3 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                        >
                          {isEditing ? '취소' : '초기화'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>,
          document.body
        )}

        {/* QR 상세/신규 폼: 신규 등록 시와 선택된 QR 수정 시 제목 구분 */}
        {((showForm && !selectedQR) || (selectedQR && selectedQRId)) && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              {selectedQR ? (
                <>
                  <Eye size={20} />
                  선택된 QR 코드 상세 정보
                </>
              ) : (
                <>
                  <QrCode size={20} />
                  신규 QR 코드 등록
                </>
              )}
            </h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <FileText size={16} className="text-blue-600" />
                  PNL NO.
                </label>
                <input
                  type="text"
                  value={qrData.id}
                  onChange={(e) => handleInputChange('id', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  placeholder="예: 1-1 또는 2-1"
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>
              
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <Building2 size={16} className="text-blue-600" />
                  층수
                </label>
                <select
                  value={qrData.floor || selectedFloor}
                  onChange={(e) => handleInputChange('floor', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
                >
                  <option value="F1">F1</option>
                  <option value="B1">B1</option>
                </select>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <MapPin size={16} className="text-blue-600" />
                  TR
                </label>
                <select
                  value={isValidTR(qrData.location) ? qrData.location : 'A'}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  onFocus={restoreMainScrollOnFocus}
                  className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white cursor-pointer"
                >
                  {TR_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <MapPin size={16} className="text-emerald-600" />
                  좌표 (Dashboard 위치 매핑)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">X (0-100%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={qrData.positionX}
                      onChange={(e) => handleInputChange('positionX', e.target.value)}
                      onFocus={restoreMainScrollOnFocus}
                      placeholder="25"
                      className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Y (0-100%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={qrData.positionY}
                      onChange={(e) => handleInputChange('positionY', e.target.value)}
                      onFocus={restoreMainScrollOnFocus}
                      placeholder="30"
                      className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                </div>
              </div>

              {selectedQR && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-slate-700">생성일</span>
                  </div>
                  <p className="text-slate-800 font-medium">{formatDate(selectedQR.createdAt)}</p>
                </div>
              )}

              <button
                onMouseDown={() => {
                  savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
                  savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
                }}
                onClick={selectedQR ? handleUpdateQR : generateQR}
                onFocus={restoreMainScrollOnFocus}
                disabled={!qrData.location || !qrData.floor}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Save size={18} />
                {selectedQR ? '저장' : 'QR 코드 생성'}
              </button>

              <button
                onMouseDown={() => {
                  savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
                  savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
                }}
                onClick={() => {
                  setGeneratedQR(selectedQR ? selectedQR.qrData : (generatedQR || ''));
                  setShowQRModal(true);
                  restoreScrollAfterAction();
                }}
                onFocus={restoreMainScrollOnFocus}
                disabled={!selectedQR && !generatedQR}
                className="w-full bg-slate-600 hover:bg-slate-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <QrCode size={18} />
                QR 코드 보기
              </button>

              <button
                onMouseDown={() => {
                  savedMainScrollOnInteractionRef.current = mainScrollRef?.current?.scrollTop ?? 0;
                  savedRightScrollOnInteractionRef.current = rightPanelScrollRef.current?.scrollTop ?? 0;
                }}
                onClick={handleMapToDashboard}
                onFocus={restoreMainScrollOnFocus}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <MapPin size={18} />
                Dashboard에 위치 매핑
              </button>
            </div>
            </div>
        )}

        {/* QR Code Modal */}
        {showQRModal && generatedQR && createPortal(
          <React.Fragment>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black bg-opacity-50 z-50"
              onClick={() => {
                setShowQRModal(false);
                setGeneratedQR(null);
              }}
            />
            {/* Modal */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div 
                className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-800">QR 코드</h2>
                    <button
                      onClick={() => {
                        setShowQRModal(false);
                        setGeneratedQR(null);
                      }}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                      title="닫기"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  
                  <div className="flex flex-col lg:flex-row gap-6">
                    {/* QR Code */}
                    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="bg-white p-4 rounded-lg shadow-sm">
                        <QRCodeSVG
                          id="qr-code-svg"
                          value={generatedQR}
                          size={256}
                          level="H"
                          includeMargin={true}
                        />
                      </div>
                      <p className="text-xs text-slate-500 mt-4 text-center">
                        QR 코드를 스캔하여 위치 정보를 확인하세요
                      </p>
                    </div>

                    {/* QR Info */}
                    <div className="flex-1 space-y-4">
                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 mb-3">
                          <Building2 size={16} className="text-blue-600" />
                          <span className="text-sm font-semibold text-slate-700">층수</span>
                        </div>
                        <p className="text-slate-800 font-medium">{qrData.floor}</p>
                      </div>

                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2 mb-3">
                          <MapPin size={16} className="text-blue-600" />
                          <span className="text-sm font-semibold text-slate-700">TR</span>
                        </div>
                        <p className="text-slate-800 font-medium">{qrData.location}</p>
                      </div>

                      {(qrData.positionX || qrData.positionY) && (
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="flex items-center gap-2 mb-3">
                            <MapPin size={16} className="text-emerald-600" />
                            <span className="text-sm font-semibold text-slate-700">좌표</span>
                          </div>
                          <p className="text-slate-800 font-medium">
                            X: {qrData.positionX || '-'}%, Y: {qrData.positionY || '-'}%
                          </p>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex flex-col gap-2 pt-2">
                        <button
                          onClick={handleMapToDashboard}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                        >
                          <MapPin size={18} />
                          Dashboard에 위치 매핑
                        </button>
                        <div className="flex gap-2">
                          <button
                            onClick={handlePrint}
                            className="flex-1 bg-slate-600 hover:bg-slate-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <Printer size={18} />
                            인쇄
                          </button>
                          <button
                            onClick={handleDownload}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <Download size={18} />
                            다운로드
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>,
          document.body
        )}
        </div>

        {/* Floor Plan View - 마지막 순서로 배치 */}
        <FloorPlanView
          inspections={inspections}
          onSelectInspection={(inspection) => {
            if (onSelectInspection) {
              onSelectInspection(inspection.panelNo);
            }
          }}
          onUpdateInspections={onUpdateInspections}
          selectedInspectionId={selectedQRId || null}
          onSelectionChange={(id) => {
            if (id) {
              const matchingQR = qrCodeMap.get(id);
              if (matchingQR) {
                setSelectedQR(matchingQR);
              } else {
                setSelectedQR(null);
                const inspection = inspections.find(i => i.panelNo === id);
                if (inspection) {
                  setQrData({
                    id: inspection.panelNo,
                    location: 'A',
                    floor: 'F1',
                    position: '',
                    positionX: inspection.position?.x?.toString() || '',
                    positionY: inspection.position?.y?.toString() || ''
                  });
                }
              }
            } else {
              setSelectedQR(null);
              setOpenDetailPanelForMapping(false); // 모달 닫을 때 플래그 해제
            }
          }}
          qrCodes={qrCodes}
          selectedFloor={selectedFloor}
          onFloorChange={setSelectedFloor}
          showDetailPanel={openDetailPanelForMapping}
          startInEditMode={openDetailPanelForMapping}
        />
      </div>
    </div>
  );
};

export default QRGenerator;
