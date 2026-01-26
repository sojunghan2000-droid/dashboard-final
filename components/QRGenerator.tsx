import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Download, Printer, MapPin, Building2, FileText, Calendar, Trash2, Eye, Edit2, X } from 'lucide-react';
import { QRCodeData, InspectionRecord } from '../types';
import FloorPlanView from './FloorPlanView';

interface QRData {
  id: string;
  location: string;
  floor: string;
  position: string;
  positionX: string;
  positionY: string;
}

const STORAGE_KEY = 'safetyguard_qrcodes';

interface QRGeneratorProps {
  inspections?: InspectionRecord[];
  onSelectInspection?: (inspectionId: string) => void;
  onUpdateInspections?: (inspections: InspectionRecord[]) => void;
}

const QRGenerator: React.FC<QRGeneratorProps> = ({ 
  inspections = [], 
  onSelectInspection,
  onUpdateInspections 
}) => {
  const [selectedFloor, setSelectedFloor] = useState<'F1' | 'B1'>('F1');
  const [qrData, setQrData] = useState<QRData>({
    id: '',
    location: '',
    floor: 'F1', // 기본값 설정
    position: '',
    positionX: '',
    positionY: ''
  });
  const [generatedQR, setGeneratedQR] = useState<string | null>(null);
  const [savedQRId, setSavedQRId] = useState<string | null>(null);
  const [qrCodes, setQrCodes] = useState<QRCodeData[]>([]);
  const [selectedQR, setSelectedQR] = useState<QRCodeData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Load QR codes from localStorage
  useEffect(() => {
    loadQRCodes();
  }, []);

  const registerAllQRCodesAsInspections = useCallback(() => {
    if (!onUpdateInspections) return;

    const savedQRCodes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const newInspections: InspectionRecord[] = [];

    savedQRCodes.forEach((qr: QRCodeData) => {
      try {
        const qrData = JSON.parse(qr.qrData);
        const position = qrData.position || {};
        
        // 이미 존재하는 InspectionRecord인지 확인
        const locationCode = qr.location.replace(/\s+/g, '-').toUpperCase();
        const floorCode = qr.floor.replace(/\s+/g, '').toUpperCase();
        
        const existingInspection = inspections.find(inspection => {
          // ID 패턴 매칭
          if (inspection.id.includes(locationCode) || inspection.id.includes(floorCode)) {
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

          const newId = `DB-${floorCode}-${locationCode}`;
          const newInspection: InspectionRecord = {
            id: newId,
            status: 'Pending',
            lastInspectionDate: '-',
            loads: { welder: false, grinder: false, light: false, pump: false },
            photoUrl: null,
            memo: `QR 코드로 생성됨\n위치: ${qr.location}\n층수: ${qr.floor}\n위치 정보: ${qr.position}`,
            position: positionObj
          };

          newInspections.push(newInspection);
        }
      } catch (e) {
        console.error('Failed to register QR code as inspection:', e);
      }
    });

    if (newInspections.length > 0) {
      const updatedInspections = [...newInspections, ...inspections];
      onUpdateInspections(updatedInspections);
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

    const savedQRCodes: QRCodeData[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
      return !existingQRIds.has(inspection.id);
    });

    if (inspectionsWithoutQR.length === 0) return;

    // 각 InspectionRecord에 대해 QR 코드 생성
    const newQRCodes: QRCodeData[] = [];
    inspectionsWithoutQR.forEach(inspection => {
      // ID에서 위치 정보 추출 (형식: DB-층수-위치, 예: DB-A-001)
      const idParts = inspection.id.split('-');
      let location = '';
      let floor = '';
      
      if (idParts.length >= 3) {
        // DB-층수-위치 형식
        floor = idParts[1] || '';
        location = idParts[2] || '';
      } else if (idParts.length >= 2) {
        // 호환성을 위해 2개 파트만 있는 경우 첫 번째를 층수로
        floor = idParts[1] || '';
      }

      // 기본값 설정
      if (!location) location = inspection.id;
      if (!floor) floor = '1';

      const position = {
        description: inspection.memo || '',
        x: inspection.position?.x,
        y: inspection.position?.y
      };

      const qrDataString = JSON.stringify({
        id: inspection.id,
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedQRCodes));
      loadQRCodes();
    }
  }, [inspections]);

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

  const loadQRCodes = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // 층수 마이그레이션: "1st" -> "F1"
      const migrated = migrateFloorFormat(saved);
      
      // 마이그레이션된 데이터를 localStorage에 저장
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } catch (e) {
        console.error('Failed to save migrated QR codes to localStorage:', e);
      }
      
      setQrCodes(migrated);
    } catch (e) {
      console.error('Failed to load QR codes:', e);
      setQrCodes([]);
    }
  };

  const handleInputChange = (field: keyof QRData, value: string) => {
    setQrData(prev => {
      const updated = {
        ...prev,
        [field]: value
      };
      
      // ID 입력 시 자동으로 층수와 위치 추출 (형식: DB-층수-위치)
      if (field === 'id' && value) {
        const idParts = value.split('-');
        if (idParts.length >= 3) {
          // DB-층수-위치 형식
          const floorFromId = idParts[1] || '';
          const locationFromId = idParts[2] || '';
          
          // 층수가 비어있으면 ID에서 추출한 값으로 설정
          if (!updated.floor && floorFromId) {
            // 층수 매핑: A -> F1, B -> B1 등 (필요시 확장)
            const floorMap: { [key: string]: string } = {
              'A': 'F1',
              'B': 'B1',
              '1': 'F1',
              'F1': 'F1',
              '1st': 'F1',
              'B1': 'B1'
            };
            updated.floor = floorMap[floorFromId.toUpperCase()] || floorFromId;
            // 층수 상태도 동기화
            if (updated.floor === 'F1' || updated.floor === 'B1') {
              setSelectedFloor(updated.floor as 'F1' | 'B1');
            }
          }
          
          // 위치가 비어있으면 ID에서 추출한 값으로 설정
          if (!updated.location && locationFromId) {
            updated.location = locationFromId;
          }
        }
      }
      
      // 층수 필드 변경 시 selectedFloor도 동기화
      if (field === 'floor' && (value === 'F1' || value === 'B1')) {
        setSelectedFloor(value as 'F1' | 'B1');
      }
      
      // 층수와 위치가 모두 입력되면 자동으로 QR 생성
      const hasFloor = updated.floor && (updated.floor === 'F1' || updated.floor === 'B1');
      const hasLocation = updated.location && updated.location.trim() !== '';
      
      if (hasFloor && hasLocation) {
        // ID가 없으면 자동 생성: DB-층수-위치
        if (!updated.id || updated.id.trim() === '') {
          updated.id = `DB-${updated.floor}-${updated.location}`;
        }
        
        // 중복 체크: 같은 층수에서 위치 번호 중복 확인
        const locationNum = parseInt(updated.location);
        if (!isNaN(locationNum)) {
          const savedQRCodes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
          const sameFloorQRCodes = savedQRCodes.filter((qr: QRCodeData) => {
            return qr.floor === updated.floor;
          });
          
          // 같은 층수에서 같은 위치 번호가 있는지 확인
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
            // 중복이면 마지막 위치 번호에 +1
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
            
            // ID도 업데이트 (위치 번호 변경)
            updated.id = `DB-${updated.floor}-${updated.location}`;
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

    // ID 생성: DB-층수-위치
    const finalId = data.id || `DB-${data.floor}-${data.location}`;

    // QR 코드에 포함될 데이터를 JSON 형식으로 생성
    const qrDataString = JSON.stringify({
      id: finalId,
      location: data.location,
      floor: data.floor,
      position: position,
      timestamp: new Date().toISOString()
    });

    // 기존 QR 코드 확인
    const savedQRCodes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedQRCodes));
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
      setGeneratedQR(qr.qrData);
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
      setGeneratedQR(qr.qrData);
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
        // ID에서 위치 정보 추출 (형식: DB-층수-위치, 예: DB-A-001 -> 001)
        const idParts = inspection.id.split('-');
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
      // 기존 Inspection 선택
      onSelectInspection(foundInspection.id);
    } else {
      // 새 InspectionRecord 생성
      const positionObj = position.x !== undefined && position.y !== undefined 
        ? { x: position.x, y: position.y }
        : undefined;

      // ID 생성: 위치 정보를 기반으로 (형식: DB-층수-위치)
      const locationCode = qr.location.replace(/\s+/g, '-').toUpperCase();
      const floorCode = qr.floor.replace(/\s+/g, '').toUpperCase();
      const newId = `DB-${floorCode}-${locationCode}`;

      const newInspection: InspectionRecord = {
        id: newId,
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
  };

  const handleUpdateQR = () => {
    if (!selectedQR || !qrData.location || !qrData.floor) {
      alert('모든 필드를 입력해주세요.');
      return;
    }

    const position = {
      description: '',
      x: qrData.positionX ? parseFloat(qrData.positionX) : undefined,
      y: qrData.positionY ? parseFloat(qrData.positionY) : undefined
    };

    const updatedQRData = JSON.stringify({
      id: qrData.id,
      location: qrData.location,
      floor: qrData.floor,
      position: position,
      timestamp: new Date().toISOString()
    });

    const updatedQRCodes = qrCodes.map(qr => 
      qr.id === selectedQR.id 
        ? {
            ...qr,
            location: qrData.location,
            floor: qrData.floor,
            position: qrData.position,
            qrData: updatedQRData
          }
        : qr
    );

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedQRCodes));
    setQrCodes(updatedQRCodes);
    setGeneratedQR(updatedQRData);
    setIsEditing(false);
    alert('QR 코드가 수정되었습니다.');
    
    // 수정된 QR 코드를 기반으로 InspectionRecord 업데이트
    if (onUpdateInspections) {
      registerAllQRCodesAsInspections();
    }
  };

  const handleDeleteQR = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('이 QR 코드를 삭제하시겠습니까?')) {
      const updated = qrCodes.filter(qr => qr.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setQrCodes(updated);
      if (selectedQR?.id === id) {
        setSelectedQR(null);
        setGeneratedQR(null);
        setQrData({ location: '', floor: '', position: '', positionX: '', positionY: '' });
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
    
    // Dashboard Overview로 이동하고 해당 마커 선택
    if (qrDataToUse.id && onSelectInspection) {
      onSelectInspection(qrDataToUse.id);
    }
  };

  const saveQRCode = (qrDataString: string): string => {
    const qrCodes: QRCodeData[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const qrDataObj = JSON.parse(qrDataString);
    
    const newQRCode: QRCodeData = {
      id: `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      location: qrDataObj.location || qrData.location,
      floor: qrDataObj.floor || qrData.floor,
      position: qrData.position,
      qrData: qrDataString,
      createdAt: new Date().toISOString()
    };
    qrCodes.unshift(newQRCode); // Add to beginning
    localStorage.setItem(STORAGE_KEY, JSON.stringify(qrCodes));
    return newQRCode.id;
  };

  const generateQR = () => {
    // ID 기반으로 위치, 층수 정보 자동 설정
    let finalLocation = qrData.location;
    let finalFloor = qrData.floor;
    
    if (qrData.id && (!finalLocation || !finalFloor)) {
      // ID에서 위치 정보 추출 (형식: DB-층수-위치, 예: DB-A-001)
      const idParts = qrData.id.split('-');
      if (idParts.length >= 3) {
        // DB-층수-위치 형식
        if (!finalFloor) finalFloor = idParts[1] || '';
        if (!finalLocation) finalLocation = idParts[2] || '';
      } else if (idParts.length >= 2) {
        // 호환성을 위해 2개 파트만 있는 경우 첫 번째를 층수로
        if (!finalFloor) finalFloor = idParts[1] || '';
      }
      
      // 기본값 설정
      if (!finalLocation) finalLocation = qrData.id;
      if (!finalFloor) finalFloor = '1';
    }

    if (!finalLocation || !finalFloor) {
      alert('ID, 층수를 모두 입력해주세요.');
      return;
    }

    // Position coordinates (optional)
    const position = {
      description: '',
      x: qrData.positionX ? parseFloat(qrData.positionX) : undefined,
      y: qrData.positionY ? parseFloat(qrData.positionY) : undefined
    };

    // QR 코드에 포함될 데이터를 JSON 형식으로 생성
    const data = JSON.stringify({
      id: qrData.id || finalLocation,
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
    const savedId = saveQRCode(data);
    setSavedQRId(savedId);
    
    // 목록 새로고침
    loadQRCodes();
    
    // 저장된 QR 코드 선택
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const newQR = saved.find((q: QRCodeData) => q.id === savedId);
    if (newQR) {
      setSelectedQR(newQR);
    }
    
    // 성공 메시지
    setShowForm(false);
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
        <span class="info-label">위치:</span>
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
      <p>SafetyGuard Pro - QR Code Generated</p>
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
      id: '',
      location: '',
      floor: '',
      position: '',
      positionX: '',
      positionY: ''
    });
    setGeneratedQR(null);
    setSelectedQR(null);
    setIsEditing(false);
    setShowForm(false);
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

  return (
    <div className="h-full flex overflow-hidden bg-slate-50">
      {/* Left Panel: QR List */}
      <div className="w-1/3 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">등록된 QR 코드</h2>
          <p className="text-sm text-slate-600">{inspections.length}개</p>
        </div>
        
        {inspections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
            <QrCode size={48} className="mb-4 opacity-50" />
            <p className="text-sm text-center">등록된 QR 코드가 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {inspections.map((inspection) => {
              // 해당 inspection에 대한 QR 코드 찾기
              const matchingQR = qrCodes.find(qr => {
                try {
                  const qrData = JSON.parse(qr.qrData);
                  return qrData.id === inspection.id;
                } catch (e) {
                  return false;
                }
              });
              
              return (
                <div
                  key={inspection.id}
                  onClick={() => {
                    if (matchingQR) {
                      handleSelectQR(matchingQR);
                    } else {
                      // QR 코드가 없으면 inspection ID를 표시하고 선택
                      setSelectedQR(null);
                      setQrData({
                        id: inspection.id,
                        location: '',
                        floor: 'F1',
                        position: '',
                        positionX: inspection.position?.x?.toString() || '',
                        positionY: inspection.position?.y?.toString() || ''
                      });
                    }
                  }}
                  className={`p-4 cursor-pointer transition-colors hover:bg-slate-50 ${
                    selectedQR && (() => {
                      try {
                        const qrData = JSON.parse(selectedQR.qrData);
                        return qrData.id === inspection.id;
                      } catch {
                        return false;
                      }
                    })() ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <MapPin size={14} className="text-blue-600" />
                        <span className="font-semibold text-slate-800">
                          {migrateIdFloor(inspection.id)}
                        </span>
                      </div>
                      {matchingQR && (
                        <>
                          <p className="text-sm text-slate-600 mb-1">{matchingQR.floor}</p>
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
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Header */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-3 bg-blue-100 rounded-lg">
                <QrCode size={24} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">QR Code Generator</h1>
                <p className="text-sm text-slate-600 mt-1">Distribution Board QR Code 생성</p>
              </div>
            </div>
          </div>

        {/* QR 생성 버튼 */}
        {!showForm && !generatedQR && !selectedQR && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex flex-col items-center justify-center py-12">
              <div className="p-4 bg-blue-100 rounded-full mb-4">
                <QrCode size={48} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-slate-800 mb-2">새 QR 코드 생성</h2>
              <p className="text-sm text-slate-600 mb-6 text-center">
                분전함의 위치 정보를 입력하여 QR 코드를 생성하세요
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
              >
                <QrCode size={20} />
                QR 코드 생성
              </button>
            </div>
          </div>
        )}

        {/* QR Code Display */}
        {generatedQR && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">생성된 QR 코드</h2>
            
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
                    <span className="text-sm font-semibold text-slate-700">위치</span>
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
        )}

        {/* Input Form */}
        {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">위치 정보 입력</h2>
            <button
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              title="닫기"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <FileText size={16} />
                ID
              </label>
              <input
                type="text"
                value={qrData.id}
                onChange={(e) => handleInputChange('id', e.target.value)}
                placeholder="예: DB-A-001"
                className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Building2 size={16} />
                층수
              </label>
              <select
                value={qrData.floor || selectedFloor}
                onChange={(e) => {
                  handleInputChange('floor', e.target.value);
                  setSelectedFloor(e.target.value as 'F1' | 'B1');
                }}
                className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              >
                <option value="F1">F1</option>
                <option value="B1">B1</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <MapPin size={16} />
                위치
              </label>
              <input
                type="text"
                value={qrData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                placeholder="예: 001"
                type="number"
                min="1"
                step="1"
                className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
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
        )}

        {/* Selected QR Details */}
        {selectedQR && !generatedQR && (() => {
          let qrId = '';
          try {
            const data = JSON.parse(selectedQR.qrData);
            qrId = data.id || '';
          } catch (e) {
            qrId = '';
          }
          
          return (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <Eye size={20} />
              선택된 QR 코드 상세 정보
            </h2>
            
            <div className="space-y-4">
              {qrId && (
                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-slate-700">ID</span>
                  </div>
                  <p className="text-slate-800 font-medium">{qrId}</p>
                </div>
              )}
              
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-slate-700">층수</span>
                </div>
                <p className="text-slate-800 font-medium">{selectedQR.floor}</p>
              </div>

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-slate-700">위치</span>
                </div>
                <p className="text-slate-800 font-medium">{selectedQR.location}</p>
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

              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-slate-700">생성일</span>
                </div>
                <p className="text-slate-800 font-medium">{formatDate(selectedQR.createdAt)}</p>
              </div>

              <button
                onClick={() => {
                  setGeneratedQR(selectedQR.qrData);
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <QrCode size={18} />
                QR 코드 보기
              </button>

              <button
                onClick={handleMapToDashboard}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <MapPin size={18} />
                Dashboard에 위치 매핑
              </button>
            </div>
            </div>
          );
        })()}
        </div>

        {/* Floor Plan View - 마지막 순서로 배치 */}
        <FloorPlanView
          inspections={inspections}
          onSelectInspection={(inspection) => {
            if (onSelectInspection) {
              onSelectInspection(inspection.id);
            }
          }}
          onUpdateInspections={onUpdateInspections}
          selectedInspectionId={(() => {
            if (selectedQR) {
              try {
                const qrData = JSON.parse(selectedQR.qrData);
                return qrData.id || null;
              } catch (e) {
                return null;
              }
            }
            return null;
          })()}
          onSelectionChange={(id) => {
            if (id && qrCodes.length > 0) {
              // 선택된 inspection ID에 해당하는 QR 코드 찾기
              const matchingQR = qrCodes.find(qr => {
                try {
                  const qrData = JSON.parse(qr.qrData);
                  return qrData.id === id;
                } catch (e) {
                  return false;
                }
              });
              if (matchingQR) {
                setSelectedQR(matchingQR);
              }
            }
          }}
          selectedFloor={selectedFloor}
          onFloorChange={setSelectedFloor}
        />
      </div>
    </div>
  );
};

export default QRGenerator;
