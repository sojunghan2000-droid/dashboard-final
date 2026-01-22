import { InspectionRecord } from '../types';

export const generateReport = (record: InspectionRecord): void => {
  const reportDate = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const connectedLoads = Object.entries(record.loads)
    .filter(([_, connected]) => connected)
    .map(([key, _]) => {
      const labels: Record<string, string> = {
        welder: 'Welder',
        grinder: 'Grinder',
        light: 'Temporary Light',
        pump: 'Water Pump'
      };
      return labels[key] || key;
    })
    .join(', ') || 'None';

  const statusColors: Record<string, string> = {
    'Complete': '#10b981',
    'In Progress': '#3b82f6',
    'Pending': '#94a3b8'
  };

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Report - ${record.id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', sans-serif;
      background: #f3f4f6;
      padding: 40px 20px;
      color: #1f2937;
    }
    .report-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: white;
      padding: 40px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .header .subtitle {
      font-size: 14px;
      opacity: 0.9;
      font-weight: 400;
    }
    .content {
      padding: 40px;
    }
    .section {
      margin-bottom: 32px;
    }
    .section:last-child {
      margin-bottom: 0;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      color: white;
    }
    .loads-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    .load-item {
      display: flex;
      align-items: center;
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .load-item.connected {
      background: #eff6ff;
      border-color: #3b82f6;
    }
    .load-check {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: #cbd5e1;
      margin-right: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .load-item.connected .load-check {
      background: #3b82f6;
    }
    .load-check::after {
      content: '✓';
      color: white;
      font-size: 14px;
      font-weight: bold;
      display: none;
    }
    .load-item.connected .load-check::after {
      display: block;
    }
    .photo-section {
      margin-top: 16px;
    }
    .photo-container {
      width: 100%;
      max-height: 400px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      margin-top: 12px;
    }
    .photo-container img {
      width: 100%;
      height: auto;
      display: block;
    }
    .memo-section {
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #3b82f6;
    }
    .memo-text {
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
      white-space: pre-wrap;
    }
    .footer {
      background: #f8fafc;
      padding: 24px 40px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
      font-size: 12px;
    }
    @media print {
      body {
        padding: 0;
        background: white;
      }
      .report-container {
        box-shadow: none;
      }
    }
  </style>
</head>
<body>
  <div class="report-container">
    <div class="header">
      <h1>SafetyGuard Pro</h1>
      <div class="subtitle">Distribution Board Inspection Report</div>
    </div>
    
    <div class="content">
      <div class="section">
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Distribution Board ID</div>
            <div class="info-value">${record.id}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Inspection Status</div>
            <div>
              <span class="status-badge" style="background-color: ${statusColors[record.status]}">
                ${record.status}
              </span>
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Inspection Date</div>
            <div class="info-value">${record.lastInspectionDate}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Report Generated</div>
            <div class="info-value">${reportDate}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Connected Loads</div>
        <div class="loads-list">
          <div class="load-item ${record.loads.welder ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Welder</span>
          </div>
          <div class="load-item ${record.loads.grinder ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Grinder</span>
          </div>
          <div class="load-item ${record.loads.light ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Temporary Light</span>
          </div>
          <div class="load-item ${record.loads.pump ? 'connected' : ''}">
            <div class="load-check"></div>
            <span>Water Pump</span>
          </div>
        </div>
        <div style="margin-top: 12px; font-size: 14px; color: #64748b;">
          <strong>Active Loads:</strong> ${connectedLoads}
        </div>
      </div>

      ${record.photoUrl ? `
      <div class="section photo-section">
        <div class="section-title">Site Photo</div>
        <div class="photo-container">
          <img src="${record.photoUrl}" alt="Inspection Site Photo" />
        </div>
      </div>
      ` : ''}

      ${record.memo ? `
      <div class="section">
        <div class="section-title">Observations & Actions</div>
        <div class="memo-section">
          <div class="memo-text">${record.memo}</div>
        </div>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p>This report was generated by SafetyGuard Pro Inspection System</p>
      <p style="margin-top: 4px;">© ${new Date().getFullYear()} SafetyGuard Pro. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  // Create a blob and download
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Inspection_Report_${record.id}_${new Date().toISOString().split('T')[0]}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  // Also open in new window for printing
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    // Auto-print after a short delay
    setTimeout(() => {
      printWindow.print();
    }, 250);
  }
};
