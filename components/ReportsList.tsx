import React, { useState } from 'react';
import { ReportHistory, InspectionRecord } from '../types';
import { viewReport, exportReportToExcel } from '../services/reportService';
import { FileText, Trash2, Calendar, CheckCircle2, Clock, AlertCircle, Search, Download } from 'lucide-react';

interface ReportsListProps {
  reports: ReportHistory[];
  onDeleteReport: (id: string) => void;
  inspections: InspectionRecord[];
}

const ReportsList: React.FC<ReportsListProps> = ({ reports, onDeleteReport, inspections }) => {
  const [selectedReport, setSelectedReport] = useState<ReportHistory | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const handleViewReport = (report: ReportHistory) => {
    viewReport(report);
  };

  const handleExportExcel = (report: ReportHistory, e: React.MouseEvent) => {
    e.stopPropagation();
    exportReportToExcel(report, inspections);
  };

  const handleDeleteReport = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('이 보고서를 삭제하시겠습니까?')) {
      onDeleteReport(id);
      if (selectedReport?.id === id) {
        setSelectedReport(null);
      }
    }
  };

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

  const filteredReports = reports
    .filter(report => report.status !== 'In Progress') // In Progress 상태 리포트 제외
    .filter(report =>
      report.boardId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      report.reportId.toLowerCase().includes(searchTerm.toLowerCase())
    );

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

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <h2 className="text-xl font-bold text-slate-800 mb-4">Generated Reports</h2>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by PNL NO. or Report ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Reports List */}
        <div className="w-1/2 border-r border-slate-200 bg-white overflow-y-auto">
          {filteredReports.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">
                {searchTerm ? 'No reports found' : 'No reports generated yet'}
              </p>
              <p className="text-sm text-center">
                {searchTerm 
                  ? 'Try a different search term' 
                  : 'Generate reports from the Dashboard to see them here'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredReports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className={`
                    p-4 cursor-pointer transition-colors hover:bg-slate-50
                    ${selectedReport?.id === report.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}
                  `}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(report.status)}
                        <span className="font-semibold text-slate-800">{report.reportId}</span>
                      </div>
                      <p className="text-sm text-slate-600 mb-2">PNL NO.: {report.boardId}</p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Calendar size={12} />
                        <span>{formatDate(report.generatedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(report.status)}`}>
                        {report.status}
                      </span>
                      <button
                        onClick={(e) => handleExportExcel(report, e)}
                        className="p-1.5 hover:bg-green-50 rounded text-slate-400 hover:text-green-600 transition-colors"
                        title="Excel로 다운로드"
                      >
                        <Download size={16} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteReport(report.id, e)}
                        className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600 transition-colors"
                        title="Delete report"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Report Preview */}
        <div className="w-1/2 bg-slate-50 overflow-y-auto">
          {selectedReport ? (
            <div className="h-full">
              {/* HTML 보고서 렌더링 */}
              <iframe
                srcDoc={selectedReport.htmlContent}
                className="w-full h-full border-0"
                title={selectedReport.reportId}
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-6">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">Select a report</p>
              <p className="text-sm text-center">Choose a report from the list to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsList;
