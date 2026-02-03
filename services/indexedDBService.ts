import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { InspectionRecord, QRCodeData } from '../types';

interface InspectionsDB extends DBSchema {
  inspections: {
    key: string; // panelNo
    value: InspectionRecord;
    indexes: { 'by-panelNo': string };
  };
  photos: {
    key: string; // panelNo
    value: {
      panelNo: string;
      photoBlob?: Blob; // optional: 사진이 없으면 undefined
      thermalImageBlob?: Blob; // optional: 열화상 이미지가 없으면 undefined
      updatedAt: number;
    };
    indexes: { 'by-panelNo': string };
  };
  qrCodes: {
    key: string; // id
    value: QRCodeData;
    indexes: { 'by-id': string };
  };
  floorPlanImages: {
    key: string; // floor (예: 'F1', 'B1', 'F1-panel-master', 'B1-panel-master')
    value: {
      floor: string;
      imageBlob: Blob;
      updatedAt: number;
    };
    indexes: { 'by-floor': string };
  };
}

let dbInstance: IDBPDatabase<InspectionsDB> | null = null;

/**
 * IndexedDB 초기화
 * 버전 2: qrCodes, floorPlanImages 저장소 추가
 */
export const initIndexedDB = async (): Promise<IDBPDatabase<InspectionsDB>> => {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<InspectionsDB>('panel-inspector-db', 2, {
    upgrade(db, oldVersion, newVersion) {
      // Inspections 저장소
      if (!db.objectStoreNames.contains('inspections')) {
        const inspectionStore = db.createObjectStore('inspections', {
          keyPath: 'panelNo',
        });
        inspectionStore.createIndex('by-panelNo', 'panelNo', { unique: true });
      }

      // Photos 저장소
      if (!db.objectStoreNames.contains('photos')) {
        const photoStore = db.createObjectStore('photos', {
          keyPath: 'panelNo',
        });
        photoStore.createIndex('by-panelNo', 'panelNo', { unique: true });
      }

      // QR Codes 저장소 (버전 2에서 추가)
      if (!db.objectStoreNames.contains('qrCodes')) {
        const qrCodeStore = db.createObjectStore('qrCodes', {
          keyPath: 'id',
        });
        qrCodeStore.createIndex('by-id', 'id', { unique: true });
      }

      // Floor Plan Images 저장소 (버전 2에서 추가)
      // 키: 'F1', 'B1' (Dashboard용), 'F1-panel-master', 'B1-panel-master' (Panel Master용)
      if (!db.objectStoreNames.contains('floorPlanImages')) {
        const floorPlanStore = db.createObjectStore('floorPlanImages', {
          keyPath: 'floor',
        });
        floorPlanStore.createIndex('by-floor', 'floor', { unique: true });
      }
    },
  });

  return dbInstance;
};

/**
 * Inspection 저장
 */
export const saveInspection = async (inspection: InspectionRecord): Promise<void> => {
  const db = await initIndexedDB();
  await db.put('inspections', inspection);
};

/**
 * 모든 Inspection 조회
 */
export const getAllInspections = async (): Promise<InspectionRecord[]> => {
  const db = await initIndexedDB();
  return await db.getAll('inspections');
};

/**
 * 특정 Inspection 조회
 */
export const getInspection = async (panelNo: string): Promise<InspectionRecord | undefined> => {
  const db = await initIndexedDB();
  return await db.get('inspections', panelNo);
};

/**
 * Inspection 삭제
 */
export const deleteInspection = async (panelNo: string): Promise<void> => {
  const db = await initIndexedDB();
  await db.delete('inspections', panelNo);
  await db.delete('photos', panelNo); // 관련 사진도 삭제
};

/**
 * 사진 저장 (Blob)
 * photoBlob과 thermalImageBlob이 모두 null이면 해당 항목을 삭제합니다.
 */
export const savePhoto = async (
  panelNo: string,
  photoBlob: Blob | null,
  thermalImageBlob?: Blob | null
): Promise<void> => {
  const db = await initIndexedDB();
  
  // 둘 다 null이면 삭제
  if (!photoBlob && !thermalImageBlob) {
    await db.delete('photos', panelNo);
    return;
  }
  
  // 하나라도 있으면 저장 (null은 undefined로 변환하여 저장하지 않음)
  await db.put('photos', {
    panelNo,
    photoBlob: photoBlob || undefined,
    thermalImageBlob: thermalImageBlob || undefined,
    updatedAt: Date.now(),
  });
};

/**
 * 사진 조회
 */
export const getPhoto = async (panelNo: string): Promise<Blob | null> => {
  const db = await initIndexedDB();
  const photoData = await db.get('photos', panelNo);
  return photoData?.photoBlob || null;
};

/**
 * 열화상 이미지 조회
 */
export const getThermalImage = async (panelNo: string): Promise<Blob | null> => {
  const db = await initIndexedDB();
  const photoData = await db.get('photos', panelNo);
  return photoData?.thermalImageBlob || null;
};

/**
 * Blob을 Data URL로 변환 (화면 표시용)
 */
export const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Data URL을 Blob으로 변환
 */
export const dataURLToBlob = (dataURL: string): Blob => {
  // null, undefined, 빈 문자열 체크
  if (!dataURL || typeof dataURL !== 'string') {
    throw new Error('Invalid dataURL: dataURL is empty or not a string');
  }
  
  // Data URL 형식 검증
  if (!dataURL.startsWith('data:')) {
    throw new Error(`Invalid dataURL format: expected data: URL, got: ${dataURL.substring(0, 50)}...`);
  }
  
  const arr = dataURL.split(',');
  
  // 콤마가 없거나 Base64 부분이 없는 경우
  if (arr.length < 2 || !arr[1]) {
    throw new Error('Invalid dataURL: missing base64 data');
  }
  
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const base64String = arr[1];
  
  // Base64 문자열 정리 (공백, 줄바꿈 제거)
  const cleanBase64 = base64String.replace(/\s+/g, '');
  
  // 빈 문자열 체크
  if (!cleanBase64 || cleanBase64 === '-') {
    throw new Error('Invalid dataURL: base64 data is empty');
  }
  
  // Base64 형식 검증
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(cleanBase64)) {
    throw new Error(`Invalid base64 format: contains invalid characters`);
  }
  
  try {
    const bstr = atob(cleanBase64);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (error) {
    throw new Error(`Failed to decode base64: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * 모든 Inspection과 사진을 함께 조회
 */
export const getAllInspectionsWithPhotos = async (): Promise<InspectionRecord[]> => {
  const inspections = await getAllInspections();
  const db = await initIndexedDB();

  // 각 Inspection에 사진 URL 추가
  const inspectionsWithPhotos = await Promise.all(
    inspections.map(async (inspection) => {
      const photoData = await db.get('photos', inspection.panelNo);

      let photoUrl: string | null = null;
      let thermalImageUrl: string | null = null;

      if (photoData?.photoBlob) {
        photoUrl = await blobToDataURL(photoData.photoBlob);
      }

      if (photoData?.thermalImageBlob) {
        thermalImageUrl = await blobToDataURL(photoData.thermalImageBlob);
      }

      return {
        ...inspection,
        photoUrl: photoUrl || inspection.photoUrl, // IndexedDB에 없으면 기존 값 사용
        thermalImage: inspection.thermalImage ? {
          ...inspection.thermalImage,
          imageUrl: thermalImageUrl || inspection.thermalImage.imageUrl,
        } : undefined,
      };
    })
  );

  return inspectionsWithPhotos;
};

// ============================================
// QR Codes 관련 함수들
// ============================================

/**
 * QR 코드 저장
 */
export const saveQRCode = async (qrCode: QRCodeData): Promise<void> => {
  const db = await initIndexedDB();
  await db.put('qrCodes', qrCode);
};

/**
 * 여러 QR 코드 한번에 저장
 */
export const saveAllQRCodes = async (qrCodes: QRCodeData[]): Promise<void> => {
  const db = await initIndexedDB();
  const tx = db.transaction('qrCodes', 'readwrite');
  await Promise.all([
    ...qrCodes.map(qr => tx.store.put(qr)),
    tx.done
  ]);
};

/**
 * 모든 QR 코드 조회
 */
export const getAllQRCodes = async (): Promise<QRCodeData[]> => {
  const db = await initIndexedDB();
  return await db.getAll('qrCodes');
};

/**
 * 특정 QR 코드 조회
 */
export const getQRCode = async (id: string): Promise<QRCodeData | undefined> => {
  const db = await initIndexedDB();
  return await db.get('qrCodes', id);
};

/**
 * QR 코드 삭제
 */
export const deleteQRCode = async (id: string): Promise<void> => {
  const db = await initIndexedDB();
  await db.delete('qrCodes', id);
};

/**
 * 모든 QR 코드 삭제
 */
export const clearAllQRCodes = async (): Promise<void> => {
  const db = await initIndexedDB();
  await db.clear('qrCodes');
};

// ============================================
// Floor Plan Images 관련 함수들
// ============================================

/**
 * 층별 배경 이미지 저장
 * @param floor - 층 식별자 (예: 'F1', 'B1', 'F1-panel-master', 'B1-panel-master')
 * @param imageBlob - 이미지 Blob
 */
export const saveFloorPlanImage = async (floor: string, imageBlob: Blob): Promise<void> => {
  const db = await initIndexedDB();
  await db.put('floorPlanImages', {
    floor,
    imageBlob,
    updatedAt: Date.now(),
  });
};

/**
 * 층별 배경 이미지 조회 (Blob 반환)
 */
export const getFloorPlanImage = async (floor: string): Promise<Blob | null> => {
  const db = await initIndexedDB();
  const data = await db.get('floorPlanImages', floor);
  return data?.imageBlob || null;
};

/**
 * 층별 배경 이미지 조회 (Data URL 반환)
 */
export const getFloorPlanImageAsDataURL = async (floor: string): Promise<string | null> => {
  const blob = await getFloorPlanImage(floor);
  if (blob) {
    return await blobToDataURL(blob);
  }
  return null;
};

/**
 * 층별 배경 이미지 삭제
 */
export const deleteFloorPlanImage = async (floor: string): Promise<void> => {
  const db = await initIndexedDB();
  await db.delete('floorPlanImages', floor);
};

/**
 * 모든 층별 배경 이미지 조회
 */
export const getAllFloorPlanImages = async (): Promise<{ floor: string; imageUrl: string }[]> => {
  const db = await initIndexedDB();
  const allImages = await db.getAll('floorPlanImages');

  const imagesWithUrls = await Promise.all(
    allImages.map(async (img) => ({
      floor: img.floor,
      imageUrl: await blobToDataURL(img.imageBlob),
    }))
  );

  return imagesWithUrls;
};
