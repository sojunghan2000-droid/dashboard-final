import type { CategoryMaster, Task } from './types';
import { categoryCodeMapping, orgCodeMapping } from './data';

type MemberInfoForCode = {
  department: string;
  team: string;
  group: string;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCategory1Code = (category1: string): string => {
  if (!category1) return 'X01';

  // Prefer explicit mapping (supports both "기획" and "기획 (PL01)" if present)
  const mapped = (categoryCodeMapping.category1 as any)[category1];
  if (mapped) return mapped;

  // Try extracting "(CODE)" pattern e.g. "기획 (PL01)" -> "PL01"
  const m = category1.match(/\(([^)]+)\)\s*$/);
  if (m?.[1]) return m[1].trim();

  // Try mapping by stripping " (CODE)"
  const stripped = category1.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const mappedStripped = (categoryCodeMapping.category1 as any)[stripped];
  if (mappedStripped) return mappedStripped;

  return 'X01';
};

const buildOrgPrefix = (memberInfo: MemberInfoForCode): string => {
  const deptCode = (orgCodeMapping.departments as any)[memberInfo.department] || 'DXX';
  const teamCode = (orgCodeMapping.teams as any)[memberInfo.team] || 'TXX';
  const groupCode = (orgCodeMapping.groups as any)[memberInfo.group] || 'GXX';
  return `${deptCode}-${teamCode}-${groupCode}`;
};

const getNextSequenceForPrefix = (existingTasks: Task[], prefixPattern: string): number => {
  // We generate strictly monotonic: max(existing)+1 (never reuse gaps)
  const re = new RegExp(`^${escapeRegExp(prefixPattern)}\\.(\\d+)(?:$|\\D)`);
  let max = 0;
  for (const t of existingTasks) {
    const code = t.taskCode || '';
    const m = code.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max + 1;
};

export const generateTaskCodeForTask2 = (params: {
  taskName: string; // Task 2
  category1: string;
  category2: string;
  category3: string;
  memberInfo: MemberInfoForCode | null;
  adminCategoryMaster: CategoryMaster;
  existingTasks: Task[];
}): string => {
  const { taskName, category1, category2, category3, memberInfo, adminCategoryMaster, existingTasks } = params;

  const trimmedName = (taskName || '').trim();
  if (trimmedName) {
    const existingSameName = existingTasks.find(t => (t.name || '').trim() === trimmedName);
    if (existingSameName?.taskCode) return existingSameName.taskCode;
  }

  if (!memberInfo || !category1 || !category2 || !category3) {
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `T-${dateStr}-${Math.floor(Math.random() * 1000)}`;
  }

  const orgPrefix = buildOrgPrefix(memberInfo);
  const cat1Code = getCategory1Code(category1);

  const cat1Data = adminCategoryMaster[category1] || {};
  const cat2Keys = Object.keys(cat1Data);
  const cat2Index = Math.max(1, cat2Keys.indexOf(category2) + 1);

  const cat3Keys = cat1Data[category2] || [];
  const cat3Index = Math.max(1, cat3Keys.indexOf(category3) + 1);

  const prefixPattern = `${orgPrefix}-${cat1Code}.${cat2Index}.${cat3Index}`;

  let seq = getNextSequenceForPrefix(existingTasks, prefixPattern);
  let candidate = `${prefixPattern}.${seq}`;
  while (existingTasks.some(t => t.taskCode === candidate)) {
    seq += 1;
    candidate = `${prefixPattern}.${seq}`;
  }
  return candidate;
};

