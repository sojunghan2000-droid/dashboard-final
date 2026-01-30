import React, { useState, useMemo } from 'react';
import { InspectionRecord } from '../types';
import { ClipboardList, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

interface BoardListProps {
  items: InspectionRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type SortField = 'panelNo' | 'status' | 'lastInspectionDate' | null;
type SortDirection = 'asc' | 'desc';

const BoardList: React.FC<BoardListProps> = ({ items, selectedId, onSelect }) => {
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // 같은 필드를 클릭하면 정렬 방향 토글
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // 다른 필드를 클릭하면 새 필드로 정렬 (기본 오름차순)
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedItems = useMemo(() => {
    if (!sortField) return items;

    return [...items].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'panelNo':
          aValue = a.panelNo;
          bValue = b.panelNo;
          break;
        case 'status':
          // 상태 우선순위: Complete > In Progress > Pending
          const statusOrder: Record<string, number> = {
            'Complete': 1,
            'In Progress': 2,
            'Pending': 3
          };
          aValue = statusOrder[a.status] || 999;
          bValue = statusOrder[b.status] || 999;
          break;
        case 'lastInspectionDate':
          // 날짜 파싱 (다양한 형식 지원)
          const parseDate = (dateStr: string): number => {
            if (dateStr === '-') return 0;
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? 0 : date.getTime();
          };
          aValue = parseDate(a.lastInspectionDate);
          bValue = parseDate(b.lastInspectionDate);
          break;
        default:
          return 0;
      }

      // 문자열 비교
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // 숫자 비교
      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });
  }, [items, sortField, sortDirection]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Complete': return <CheckCircle size={16} className="text-emerald-500" />;
      case 'In Progress': return <Clock size={16} className="text-blue-500" />;
      default: return <AlertTriangle size={16} className="text-slate-400" />;
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-slate-100 bg-slate-50">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <ClipboardList size={18} />
            Board List
          </h3>
          <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{items.length} Items</span>
        </div>
        <p className="text-xs text-slate-500 mt-1.5">데이터는 DB Master에 등록된 분전함의 내용을 기반으로 생성됩니다.</p>
      </div>
      <div className="overflow-y-auto flex-1">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
            <tr>
              <th 
                className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 transition-colors select-none"
                onDoubleClick={() => handleSort('panelNo')}
                title="더블 클릭하여 정렬"
              >
                PNL NO.{getSortIcon('panelNo')}
              </th>
              <th 
                className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 transition-colors select-none"
                onDoubleClick={() => handleSort('status')}
                title="더블 클릭하여 정렬"
              >
                Status{getSortIcon('status')}
              </th>
              <th 
                className="px-4 py-3 font-medium text-right cursor-pointer hover:bg-slate-100 transition-colors select-none"
                onDoubleClick={() => handleSort('lastInspectionDate')}
                title="더블 클릭하여 정렬"
              >
                Last Check{getSortIcon('lastInspectionDate')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedItems.map((item) => (
              <tr 
                key={item.panelNo}
                onClick={() => onSelect(item.panelNo)}
                className={`
                  cursor-pointer transition-colors hover:bg-blue-50
                  ${selectedId === item.panelNo ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}
                `}
              >
                <td className="px-4 py-3 font-medium text-slate-800">{item.panelNo}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(item.status)}
                    <span className={`
                      ${item.status === 'Complete' ? 'text-emerald-700' : ''}
                      ${item.status === 'In Progress' ? 'text-blue-700' : ''}
                      ${item.status === 'Pending' ? 'text-slate-500' : ''}
                    `}>
                      {item.status}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-slate-500 font-mono text-xs">{item.lastInspectionDate}</td>
              </tr>
            ))}
            {sortedItems.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-400">
                  No records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BoardList;