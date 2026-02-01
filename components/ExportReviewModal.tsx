import React from 'react';
import { InspectionRecord } from '../types';
import { FileSpreadsheet, X, Camera, Thermometer, AlertCircle } from 'lucide-react';

interface ExportReviewModalProps {
  inspections: InspectionRecord[];
  onConfirm: () => void;
  onCancel: () => void;
  isExporting?: boolean;
}

/**
 * 엑셀 내보내기 전 검토 모달
 * 각 PNL NO별 현장사진/열화상 이미지가 올바르게 매칭되는지 확인
 */
const ExportReviewModal: React.FC<ExportReviewModalProps> = ({
  inspections,
  onConfirm,
  onCancel,
  isExporting = false,
}) => {
  const withPhotos = inspections.filter(
    (i) => i.photoUrl || i.thermalImage?.imageUrl
  );
  const withSitePhoto = inspections.filter((i) => i.photoUrl);
  const withThermal = inspections.filter((i) => i.thermalImage?.imageUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 md:p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-w-[calc(100vw-24px)] max-h-[90dvh] md:max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <FileSpreadsheet size={22} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">엑셀 내보내기 검토</h3>
              <p className="text-sm text-slate-500">
                사진이 올바르게 매칭되는지 확인 후 내보내기를 진행하세요.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isExporting}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* 요약 */}
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-2 md:gap-4 text-sm">
          <span className="text-slate-600">
            총 <strong>{inspections.length}</strong>개 패널
          </span>
          <span className="text-emerald-600">
            현장사진 <strong>{withSitePhoto.length}</strong>개
          </span>
          <span className="text-amber-600">
            열화상 <strong>{withThermal.length}</strong>개
          </span>
        </div>

        {/* 사진 목록 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {withPhotos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <AlertCircle size={48} className="mb-3 text-slate-300" />
              <p>사진이 있는 패널이 없습니다.</p>
              <p className="text-sm mt-1">텍스트 데이터만 내보내집니다.</p>
            </div>
          ) : (
            withPhotos.map((inspection) => (
              <div
                key={inspection.panelNo}
                className="border border-slate-200 rounded-lg p-3 bg-white"
              >
                <div className="font-medium text-slate-800 mb-2">
                  PNL NO. {inspection.panelNo}
                </div>
                <div className="flex gap-4">
                  {/* 현장사진 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      <Camera size={14} />
                      현장사진
                    </div>
                    {inspection.photoUrl ? (
                      <img
                        src={inspection.photoUrl}
                        alt={`${inspection.panelNo} 현장사진`}
                        className="w-full h-24 object-cover rounded border border-slate-200 bg-slate-50"
                      />
                    ) : (
                      <div className="w-full h-24 rounded border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 text-xs">
                        없음
                      </div>
                    )}
                  </div>
                  {/* 열화상 이미지 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      <Thermometer size={14} />
                      열화상 이미지
                    </div>
                    {inspection.thermalImage?.imageUrl ? (
                      <img
                        src={inspection.thermalImage.imageUrl}
                        alt={`${inspection.panelNo} 열화상`}
                        className="w-full h-24 object-cover rounded border border-slate-200 bg-slate-50"
                      />
                    ) : (
                      <div className="w-full h-24 rounded border border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 text-xs">
                        없음
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 버튼 */}
        <div className="flex justify-end gap-3 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button
            onClick={onCancel}
            disabled={isExporting}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={isExporting}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>내보내는 중...</span>
              </>
            ) : (
              <>
                <FileSpreadsheet size={18} />
                <span>내보내기 진행</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportReviewModal;
