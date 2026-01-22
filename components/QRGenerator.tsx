import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Download, Printer, MapPin, Building2, FileText } from 'lucide-react';
import { QRCodeData } from '../types';

interface QRData {
  location: string;
  floor: string;
  position: string;
}

const STORAGE_KEY = 'safetyguard_qrcodes';

const QRGenerator: React.FC = () => {
  const [qrData, setQrData] = useState<QRData>({
    location: '',
    floor: '',
    position: ''
  });
  const [generatedQR, setGeneratedQR] = useState<string | null>(null);
  const [savedQRId, setSavedQRId] = useState<string | null>(null);

  const handleInputChange = (field: keyof QRData, value: string) => {
    setQrData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const saveQRCode = (qrDataString: string): string => {
    const qrCodes: QRCodeData[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const newQRCode: QRCodeData = {
      id: `qr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      location: qrData.location,
      floor: qrData.floor,
      position: qrData.position,
      qrData: qrDataString,
      createdAt: new Date().toISOString()
    };
    qrCodes.unshift(newQRCode); // Add to beginning
    localStorage.setItem(STORAGE_KEY, JSON.stringify(qrCodes));
    return newQRCode.id;
  };

  const generateQR = () => {
    if (!qrData.location || !qrData.floor || !qrData.position) {
      alert('모든 필드를 입력해주세요.');
      return;
    }

    // QR 코드에 포함될 데이터를 JSON 형식으로 생성
    const data = JSON.stringify({
      location: qrData.location,
      floor: qrData.floor,
      position: qrData.position,
      timestamp: new Date().toISOString()
    });

    setGeneratedQR(data);
    
    // QR 코드와 위치 정보 저장
    const savedId = saveQRCode(data);
    setSavedQRId(savedId);
    
    // 성공 메시지
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
      location: '',
      floor: '',
      position: ''
    });
    setGeneratedQR(null);
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
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

        {/* Input Form */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">위치 정보 입력</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <MapPin size={16} />
                위치
              </label>
              <input
                type="text"
                value={qrData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                placeholder="예: Building A, Zone 1"
                className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Building2 size={16} />
                층수
              </label>
              <input
                type="text"
                value={qrData.floor}
                onChange={(e) => handleInputChange('floor', e.target.value)}
                placeholder="예: 1층, 2층, B1층"
                className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <FileText size={16} />
                위치 정보
              </label>
              <textarea
                value={qrData.position}
                onChange={(e) => handleInputChange('position', e.target.value)}
                placeholder="예: 복도 중앙, 엘리베이터 옆, 화재 계단 앞"
                rows={3}
                className="w-full rounded-lg border-slate-300 border px-4 py-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none transition-all"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={generateQR}
                disabled={!qrData.location || !qrData.floor || !qrData.position}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <QrCode size={18} />
                QR 코드 생성
              </button>
              {generatedQR && (
                <button
                  onClick={resetForm}
                  className="px-6 py-3 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
        </div>

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
                    <MapPin size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-slate-700">위치</span>
                  </div>
                  <p className="text-slate-800 font-medium">{qrData.location}</p>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-slate-700">층수</span>
                  </div>
                  <p className="text-slate-800 font-medium">{qrData.floor}</p>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText size={16} className="text-blue-600" />
                    <span className="text-sm font-semibold text-slate-700">위치 정보</span>
                  </div>
                  <p className="text-slate-800 font-medium">{qrData.position}</p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
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
        )}
      </div>
    </div>
  );
};

export default QRGenerator;
