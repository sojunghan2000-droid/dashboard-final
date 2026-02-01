import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { InspectionRecord, Loads, BreakerInfo, ThermalImageData, LoadSummary } from '../types';
import { Save, FileText, Camera, Upload, Sparkles, AlertCircle, CheckCircle2, Mic, MicOff, MapPin, Plus, Trash2, Thermometer } from 'lucide-react';
import { analyzeInspectionPhoto } from '../services/geminiService';

interface InspectionDetailProps {
  record: InspectionRecord;
  onSave: (updatedRecord: InspectionRecord) => void;
  onGenerateReport?: (record: InspectionRecord) => void;
  onCancel: () => void;
  onFormDataChange?: (formData: InspectionRecord) => void; // 최신 formData 전달용
}

const InspectionDetail: React.FC<InspectionDetailProps> = ({ record, onSave, onGenerateReport, onCancel, onFormDataChange }) => {
  // 기본값으로 안전한 record 생성 (hooks는 항상 호출되어야 함)
  const safeRecord: InspectionRecord = record || {
    panelNo: 'UNKNOWN',
    status: 'Pending',
    lastInspectionDate: '-',
    loads: { welder: false, grinder: false, light: false, pump: false },
    photoUrl: null,
    memo: '',
    position: { x: 50, y: 50 }
  };

  const [formData, setFormData] = useState<InspectionRecord>(safeRecord);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [activeVoiceField, setActiveVoiceField] = useState<string | null>(null); // 현재 음성 입력 중인 필드
  const recognitionRef = useRef<any>(null);
  const lastTranscriptRef = useRef<string>('');
  const processedResultsRef = useRef<Set<number>>(new Set());
  const silenceTimerRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(0);
  const isListeningRef = useRef<boolean>(false);
  const activeFieldRef = useRef<string | null>(null); // 음성 입력 대상 필드
  const prevRecordRef = useRef<InspectionRecord>(safeRecord);
  const isUpdatingFromRecordRef = useRef(false);
  const onFormDataChangeRef = useRef(onFormDataChange);

  // onFormDataChange ref 업데이트
  useEffect(() => {
    onFormDataChangeRef.current = onFormDataChange;
  }, [onFormDataChange]);

  // record가 변경될 때 formData 초기화
  useEffect(() => {
    try {
      // record가 없으면 기본값 사용
      const currentRecord = record || safeRecord;
      
      // record가 실제로 변경된 경우에만 업데이트
      if (prevRecordRef.current.panelNo !== currentRecord.panelNo || 
          prevRecordRef.current.photoUrl !== currentRecord.photoUrl) {
        isUpdatingFromRecordRef.current = true;
        const newFormData = {
          ...currentRecord,
          position: currentRecord.position || { x: 50, y: 50 }
        };
        setFormData(newFormData);
        setAiMessage(null);
        prevRecordRef.current = { ...currentRecord }; // 객체 복사
        // 다음 렌더링 사이클에서 플래그 리셋
        setTimeout(() => {
          isUpdatingFromRecordRef.current = false;
        }, 0);
      }
    } catch (error) {
      console.error('Error updating formData from record:', error);
      // 에러 발생 시에도 기본값으로 설정
      const currentRecord = record || safeRecord;
    setFormData({
        ...currentRecord,
        position: currentRecord.position || { x: 50, y: 50 }
      });
    }
  }, [record, safeRecord]);

  // formData가 사용자에 의해 변경될 때만 부모 컴포넌트에 전달
  const prevFormDataRef = useRef<InspectionRecord>(formData);
  const isInitialMountRef = useRef(true);
  
  useEffect(() => {
    try {
      // 초기 마운트 시에는 전달하지 않음
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false;
        prevFormDataRef.current = { ...formData }; // 객체 복사
        return;
      }

      // record 변경으로 인한 업데이트는 제외
      if (isUpdatingFromRecordRef.current) {
        prevFormDataRef.current = { ...formData }; // 객체 복사
        return;
      }

      // formData가 실제로 변경된 경우에만 전달
      // JSON 비교로 실제 변경 여부 확인 (성능을 위해 간단한 필드만 비교)
      const hasChanged = 
        prevFormDataRef.current.photoUrl !== formData.photoUrl ||
        prevFormDataRef.current.memo !== formData.memo ||
        prevFormDataRef.current.status !== formData.status ||
        JSON.stringify(prevFormDataRef.current.loads) !== JSON.stringify(formData.loads);

      if (hasChanged && onFormDataChangeRef.current) {
        onFormDataChangeRef.current({ ...formData }); // 객체 복사하여 전달
      }
      
      prevFormDataRef.current = { ...formData }; // 객체 복사
    } catch (error) {
      console.error('Error in formData change handler:', error);
      // 에러 발생 시에도 계속 진행
    }
  }, [formData]);

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true; // 계속 인식하도록 변경
      recognition.interimResults = true;
      recognition.lang = 'ko-KR,en-US'; // 한국어와 영어 둘 다 지원

      recognition.onresult = (event: any) => {
        // 음성 활동이 있으면 타이머 리셋
        lastActivityRef.current = Date.now();
        
        // 기존 타이머 클리어
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        let finalTranscript = '';

        // 이미 처리된 결과는 건너뛰기
        for (let i = event.resultIndex; i < event.results.length; i++) {
          // 중복 체크: 이미 처리된 인덱스는 건너뛰기
          if (processedResultsRef.current.has(i)) {
            continue;
          }

          const transcript = event.results[i][0].transcript.trim();
          
          if (event.results[i].isFinal && transcript) {
            // 중복 방지: 마지막으로 추가된 텍스트와 동일하면 건너뛰기
            if (transcript !== lastTranscriptRef.current) {
              finalTranscript += transcript + ' ';
              processedResultsRef.current.add(i);
            }
          }
        }

        if (finalTranscript.trim()) {
          const newText = finalTranscript.trim();
          // 마지막 텍스트 저장
          lastTranscriptRef.current = newText;
          
          // 활성화된 필드에 따라 다른 처리
          const activeField = activeFieldRef.current;
          
          if (activeField && activeField.startsWith('breaker-')) {
            // 차단기 필드 처리
            const parts = activeField.split('-');
            const breakerIndex = parseInt(parts[1]);
            const fieldName = parts[2];
            
            if (fieldName === 'breakerNo' || fieldName === 'loadName' || fieldName === 'type') {
              // 문자열 필드
              handleBreakerChange(breakerIndex, fieldName as keyof BreakerInfo, newText);
            } else if (fieldName === 'category') {
              // 구분 필드 (1차 또는 2차)
              const category = newText.includes('1차') || newText.includes('일차') ? '1차' : 
                              newText.includes('2차') || newText.includes('이차') ? '2차' : '1차';
              handleBreakerChange(breakerIndex, 'category', category);
            } else if (fieldName === 'kind') {
              // 종류 필드 (MCCB 또는 ELB)
              const kind = newText.toUpperCase().includes('ELB') ? 'ELB' : 'MCCB';
              handleBreakerChange(breakerIndex, 'kind', kind);
            } else {
              // 숫자 필드
              const numValue = parseFloat(newText.replace(/[^0-9.]/g, '')) || 0;
              handleBreakerChange(breakerIndex, fieldName as keyof BreakerInfo, numValue);
            }
          } else if (activeField === 'memo') {
            // 메모 필드
            setFormData(prev => ({
              ...prev,
              memo: (prev.memo ? prev.memo + ' ' : '') + newText
            }));
          }

          // continuous 모드에서는 자동 종료하지 않음
          // 버튼을 다시 누를 때까지 계속 인식
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        
        // 일부 에러는 무시하고 계속 인식
        if (event.error === 'no-speech') {
          // 음성이 없을 때는 에러로 처리하지 않고 계속 인식
          console.log('No speech detected, continuing...');
          return;
        } else if (event.error === 'aborted') {
          // 중단된 경우는 정상적인 종료로 처리
          console.log('Recognition aborted');
          setIsListening(false);
          setActiveVoiceField(null);
          activeFieldRef.current = null;
          processedResultsRef.current.clear();
          lastTranscriptRef.current = '';
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          return;
        } else if (event.error === 'network') {
          // 네트워크 에러는 재시도하지 않고 종료
          console.error('Network error in speech recognition');
          setIsListening(false);
          setActiveVoiceField(null);
          activeFieldRef.current = null;
          alert('네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.');
        } else if (event.error === 'not-allowed') {
          setIsListening(false);
          setActiveVoiceField(null);
          activeFieldRef.current = null;
          alert('마이크 권한이 거부되었습니다. 마이크 접근을 허용해주세요.');
        } else {
          // 기타 에러는 로그만 남기고 계속 시도
          console.error('Speech recognition error:', event.error);
        }
        
        // 심각한 에러가 아닌 경우 상태 초기화
        if (event.error === 'not-allowed' || event.error === 'network') {
          processedResultsRef.current.clear();
          lastTranscriptRef.current = '';
          activeFieldRef.current = null;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
      };

      recognition.onend = () => {
        // continuous 모드에서는 자동으로 재시작
        // 버튼을 다시 누르기 전까지 계속 인식
        if (isListeningRef.current && recognitionRef.current) {
          try {
            // 잠시 후 자동 재시작
            setTimeout(() => {
              if (isListeningRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e: any) {
                  // 이미 실행 중이거나 에러 발생 시 무시
                  if (e.message && !e.message.includes('already started')) {
                    console.log('Auto-restart failed:', e);
                  }
                }
              }
            }, 100);
          } catch (e) {
            console.log('Error in onend handler:', e);
          }
        } else {
          // 사용자가 버튼을 눌러 종료한 경우
          setIsListening(false);
          setActiveVoiceField(null);
          activeFieldRef.current = null;
          processedResultsRef.current.clear();
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
      };

      recognition.onstart = () => {
        // 새로운 인식 시작 시 초기화
        processedResultsRef.current.clear();
        lastTranscriptRef.current = '';
        lastActivityRef.current = Date.now();
        
        // 기존 타이머 클리어 (자동 종료 없음)
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        
        // continuous 모드에서는 자동 종료하지 않음
        // 버튼을 다시 누를 때까지 계속 인식
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // 이미 종료된 경우 무시
        }
      }
      processedResultsRef.current.clear();
      lastTranscriptRef.current = '';
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  }, []);

  // 음성 인식 필드 활성화 여부 확인 헬퍼 함수
  const isFieldListening = useCallback((fieldId: string): boolean => {
    return isListening && activeVoiceField === fieldId;
  }, [isListening, activeVoiceField]);

  const toggleListening = (fieldId?: string) => {
    if (!recognitionRef.current) {
      alert('이 브라우저에서는 음성 인식을 지원하지 않습니다.');
      return;
    }

    const targetField = fieldId || 'memo';

    if (isListening && activeVoiceField === targetField) {
      // 종료
      isListeningRef.current = false;
      activeFieldRef.current = null;
      try {
        recognitionRef.current.stop();
      } catch (error) {
        console.error('Error stopping recognition:', error);
      }
      setIsListening(false);
      setActiveVoiceField(null);
      processedResultsRef.current.clear();
      lastTranscriptRef.current = '';
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else {
      // 시작
      try {
        // 기존 타이머 클리어
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        
        // 초기화 후 시작
        processedResultsRef.current.clear();
        lastTranscriptRef.current = '';
        isListeningRef.current = true;
        activeFieldRef.current = targetField;
        
        // 이미 실행 중이 아닌지 확인
        try {
          if (isListening) {
            // 다른 필드로 전환하는 경우 기존 인식 중지 후 재시작
            recognitionRef.current.stop();
            setTimeout(() => {
              recognitionRef.current.start();
            }, 100);
          } else {
            recognitionRef.current.start();
          }
          setIsListening(true);
          setActiveVoiceField(targetField);
        } catch (startError: any) {
          // 이미 실행 중인 경우 에러 무시
          if (startError.message && startError.message.includes('already started')) {
            console.log('Recognition already started');
            setIsListening(true);
            setActiveVoiceField(targetField);
            isListeningRef.current = true;
          } else {
            isListeningRef.current = false;
            activeFieldRef.current = null;
            throw startError;
          }
        }
      } catch (error: any) {
        console.error('Error starting speech recognition:', error);
        isListeningRef.current = false;
        activeFieldRef.current = null;
        setIsListening(false);
        setActiveVoiceField(null);
        if (error.message && error.message.includes('not-allowed')) {
          alert('마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 접근을 허용해주세요.');
        } else {
          alert('음성 인식을 시작할 수 없습니다. 마이크가 연결되어 있는지 확인해주세요.');
        }
      }
    }
  };

  const handleLoadChange = useCallback((key: keyof Loads) => {
    setFormData(prev => ({
      ...prev,
      loads: {
        ...prev.loads,
        [key]: !prev.loads[key]
      }
    }));
  }, []);

  const handleMemoChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, memo: e.target.value }));
  }, []);

  const handleStatusChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InspectionDetail.tsx:337',message:'handleStatusChange called',data:{oldValue:e.target.defaultValue,newValue:e.target.value,selectElement:!!e.target},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    setFormData(prev => {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/d3499377-2a3e-49de-91f7-b42902b9b2ce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InspectionDetail.tsx:339',message:'handleStatusChange updating formData',data:{oldStatus:prev.status,newStatus:e.target.value},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      return { ...prev, status: e.target.value as InspectionRecord['status'] };
    });
  }, []);

  const handleBasicInfoChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleInspectorChange = useCallback((index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      inspectors: prev.inspectors ? prev.inspectors.map((insp, i) => i === index ? value : insp) : [value]
    }));
  }, []);

  const addInspector = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      inspectors: [...(prev.inspectors || []), '']
    }));
  }, []);

  const removeInspector = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      inspectors: prev.inspectors?.filter((_, i) => i !== index) || []
    }));
  }, []);

  const handleBreakerChange = useCallback((index: number, field: keyof BreakerInfo, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      breakers: prev.breakers?.map((breaker, i) => 
        i === index ? { ...breaker, [field]: value } : breaker
      ) || []
    }));
  }, []);

  const addBreaker = useCallback(() => {
    const newBreaker: BreakerInfo = {
      breakerNo: '0', // 기본값 0
      category: '1차',
      breakerCapacity: 0,
      loadName: '',
      type: '1P', // 기본값 1P
      kind: 'MCCB',
      currentL1: 0,
      currentL2: 0,
      currentL3: 0,
      loadCapacityR: 0,
      loadCapacityS: 0,
      loadCapacityT: 0,
      loadCapacityN: 0
    };
    setFormData(prev => ({
      ...prev,
      breakers: [...(prev.breakers || []), newBreaker]
    }));
  }, []);

  const removeBreaker = useCallback((index: number) => {
    setFormData(prev => ({
      ...prev,
      breakers: prev.breakers?.filter((_, i) => i !== index) || []
    }));
  }, []);

  const handleGroundingChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, grounding: e.target.value as '양호' | '불량' | '미점검' }));
  }, []);

  const handleThermalImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({
          ...prev,
          thermalImage: {
            ...prev.thermalImage,
            imageUrl: reader.result as string,
            equipment: prev.thermalImage?.equipment || 'KT-352',
            temperature: prev.thermalImage?.temperature || 0,
            maxTemp: prev.thermalImage?.maxTemp || 0,
            minTemp: prev.thermalImage?.minTemp || 0,
            emissivity: prev.thermalImage?.emissivity || 0.95,
            measurementTime: prev.thermalImage?.measurementTime || new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          } as ThermalImageData
        }));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleThermalImageDataChange = useCallback((field: keyof ThermalImageData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      thermalImage: {
        ...prev.thermalImage,
        [field]: value
      } as ThermalImageData
    }));
  }, []);

  const handleLoadSummaryChange = useCallback((field: keyof LoadSummary, value: number) => {
    setFormData(prev => ({
      ...prev,
      loadSummary: {
        ...prev.loadSummary,
        [field]: value
      } as LoadSummary
    }));
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // 파일 크기 검증 (10MB 제한)
      if (file.size > 10 * 1024 * 1024) {
        alert('파일 크기는 10MB 이하여야 합니다.');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photoUrl: reader.result as string }));
        setAiMessage(null);
      };
      reader.onerror = () => {
        alert('파일 읽기 중 오류가 발생했습니다.');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    }
    // 파일 입력 리셋 (같은 파일을 다시 선택할 수 있도록)
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handlePhotoDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      // 파일 크기 검증
      if (file.size > 10 * 1024 * 1024) {
        alert('파일 크기는 10MB 이하여야 합니다.');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photoUrl: reader.result as string }));
        setAiMessage(null);
      };
      reader.onerror = () => {
        alert('파일 읽기 중 오류가 발생했습니다.');
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handlePhotoDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleAnalyzePhoto = useCallback(async () => {
    if (!formData.photoUrl) return;
    setIsAnalyzing(true);
    setAiMessage(null);
    try {
      const result = await analyzeInspectionPhoto(formData.photoUrl);
      
      // Auto-update loads based on AI (Case insensitive matching)
      const newLoads = { ...formData.loads };
      const detected: string[] = [];
      
      const checkLoad = (keyword: string) => 
        result.loads.some(l => l.toLowerCase().includes(keyword.toLowerCase()));

      if (checkLoad('welder')) { newLoads.welder = true; detected.push('Welder'); }
      if (checkLoad('grinder')) { newLoads.grinder = true; detected.push('Grinder'); }
      if (checkLoad('light')) { newLoads.light = true; detected.push('Light'); }
      if (checkLoad('pump')) { newLoads.pump = true; detected.push('Pump'); }

      setFormData(prev => ({
        ...prev,
        loads: newLoads,
        memo: (prev.memo ? prev.memo + '\n' : '') + `[AI Assessment]: ${result.safetyNotes}`
      }));

      setAiMessage(`AI Detected: ${detected.join(', ') || 'None'}. Safety notes added.`);
    } catch (err) {
      setAiMessage("AI analysis failed. Please try again.");
    } finally {
      setIsAnalyzing(false);
    }
  }, [formData.photoUrl, formData.loads]);

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'Complete': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'In Progress': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  }, []);

  const statusColorClass = useMemo(() => getStatusColor(formData.status), [formData.status, getStatusColor]);

  // record가 없으면 에러 메시지 표시
  if (!record) {
    return (
      <div className="bg-white h-full flex flex-col shadow-xl border-l border-slate-200 overflow-hidden">
        <div className="h-full flex flex-col items-center justify-center">
          <p className="text-slate-500 text-lg">레코드 정보를 불러올 수 없습니다.</p>
          <button
            onClick={onCancel}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white h-full flex flex-col shadow-xl border-l-0 md:border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-100 flex justify-between items-center gap-2 bg-slate-50/50 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base md:text-xl font-bold text-slate-800 flex flex-wrap items-center gap-2">
            <span className="bg-slate-200 text-slate-600 px-2 py-1 rounded text-sm">PNL NO.</span>
            {formData.panelNo}
          </h2>
          <p className="text-sm text-slate-500 mt-1">가설 전기 점검</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-medium border ${statusColorClass}`}>
          {formData.status}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
        
        {/* 기본 정보 섹션 */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-bold text-green-800 mb-4">공사용 가설 분전반</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">PNL NO.</label>
              <input 
                type="text" 
                value={formData.panelNo || ''} 
                onChange={(e) => handleBasicInfoChange('panelNo', e.target.value)}
                className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="예: PNL NO. 1"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">PJT명</label>
              <input 
                type="text" 
                value={formData.projectName || ''} 
                onChange={(e) => handleBasicInfoChange('projectName', e.target.value)}
                className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">시공사</label>
              <input 
                type="text" 
                value={formData.contractor || ''} 
                onChange={(e) => handleBasicInfoChange('contractor', e.target.value)}
                className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">관리번호 (판넬명)</label>
              <input 
                type="text" 
                value={formData.managementNumber || ''} 
                onChange={(e) => handleBasicInfoChange('managementNumber', e.target.value)}
                className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {/* 점검자 정보 */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-slate-700">점검자</label>
              <button
                type="button"
                onClick={addInspector}
                className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
              >
                <Plus size={14} />
                추가
              </button>
            </div>
            <div className="space-y-2">
              {(formData.inspectors || []).map((inspector, index) => (
                <div key={index} className="flex gap-2">
                  <input 
                    type="text" 
                    value={inspector} 
                    onChange={(e) => handleInspectorChange(index, e.target.value)}
                    className="flex-1 rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="예: 이재두 프로"
                  />
                  <button
                    type="button"
                    onClick={() => removeInspector(index)}
                    className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {(!formData.inspectors || formData.inspectors.length === 0) && (
                <p className="text-sm text-slate-500">점검자를 추가해주세요</p>
              )}
            </div>
          </div>

          {/* 상태 및 점검일 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">상태</label>
              <select 
                value={formData.status} 
                onChange={handleStatusChange}
                className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                style={{ pointerEvents: 'auto', zIndex: 9999, position: 'relative' }}
              >
                <option value="Complete">양호</option>
                <option value="In Progress">점검 중</option>
                <option value="Pending">미점검</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">점검일</label>
              <input 
                type="text" 
                value={formData.lastInspectionDate} 
                onChange={(e) => handleBasicInfoChange('lastInspectionDate', e.target.value)}
                className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="예: 2024-05-20 09:30:45"
              />
            </div>
          </div>
        </div>

        {/* 차단기 정보 섹션 */}
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-slate-800">차단기 정보</h3>
            <button
              type="button"
              onClick={addBreaker}
              className="flex items-center gap-1 text-sm bg-green-100 text-green-700 px-3 py-1.5 rounded hover:bg-green-200"
            >
              <Plus size={16} />
              차단기 추가
            </button>
          </div>

          <div className="space-y-4">
            {(formData.breakers || []).map((breaker, index) => (
              <div key={index} className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-slate-700">차단기 #{index + 1}</h4>
                  <button
                    type="button"
                    onClick={() => removeBreaker(index)}
                    className="text-red-600 hover:bg-red-50 p-1 rounded"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">차단기 No.</label>
                      <button
                        type="button"
                        onClick={() => toggleListening(`breaker-${index}-breakerNo`)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          isListening && activeVoiceField === `breaker-${index}-breakerNo`
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                        }`}
                      >
                        {isListening && activeVoiceField === `breaker-${index}-breakerNo` ? (
                          <>
                            <MicOff size={12} />
                            <span>중지</span>
                          </>
                        ) : (
                          <>
                            <Mic size={12} />
                            <span>음성</span>
                          </>
                        )}
                      </button>
                    </div>
                    <select 
                      value={breaker.breakerNo || '0'} 
                      onChange={(e) => handleBreakerChange(index, 'breakerNo', e.target.value)}
                      className={`w-full rounded border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer bg-white ${
                        isListening && activeVoiceField === `breaker-${index}-breakerNo` ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      style={{ pointerEvents: 'auto', zIndex: 9999, position: 'relative' }}
                    >
                      {Array.from({ length: 11 }, (_, i) => (
                        <option key={i} value={i.toString()}>{i}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">구분</label>
                      <button
                        type="button"
                        onClick={() => toggleListening(`breaker-${index}-category`)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          isListening && activeVoiceField === `breaker-${index}-category`
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                        }`}
                      >
                        {isListening && activeVoiceField === `breaker-${index}-category` ? (
                          <>
                            <MicOff size={12} />
                            <span>중지</span>
                          </>
                        ) : (
                          <>
                            <Mic size={12} />
                            <span>음성</span>
                          </>
                        )}
                      </button>
                    </div>
                    <select 
                      value={breaker.category} 
                      onChange={(e) => handleBreakerChange(index, 'category', e.target.value as '1차' | '2차')}
                      className={`w-full rounded border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer bg-white ${
                        isListening && activeVoiceField === `breaker-${index}-category` ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      style={{ pointerEvents: 'auto', zIndex: 9999, position: 'relative' }}
                    >
                      <option value="1차">1차</option>
                      <option value="2차">2차</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">차단기 용량[A]</label>
                      <button
                        type="button"
                        onClick={() => toggleListening(`breaker-${index}-breakerCapacity`)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          isListening && activeVoiceField === `breaker-${index}-breakerCapacity`
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                        }`}
                      >
                        {isListening && activeVoiceField === `breaker-${index}-breakerCapacity` ? (
                          <>
                            <MicOff size={12} />
                            <span>중지</span>
                          </>
                        ) : (
                          <>
                            <Mic size={12} />
                            <span>음성</span>
                          </>
                        )}
                      </button>
                    </div>
                    <input 
                      type="number" 
                      value={breaker.breakerCapacity} 
                      onChange={(e) => handleBreakerChange(index, 'breakerCapacity', parseFloat(e.target.value) || 0)}
                      className={`w-full rounded border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none ${
                        isListening && activeVoiceField === `breaker-${index}-breakerCapacity` ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">종류</label>
                      <button
                        type="button"
                        onClick={() => toggleListening(`breaker-${index}-kind`)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          isListening && activeVoiceField === `breaker-${index}-kind`
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                        }`}
                      >
                        {isListening && activeVoiceField === `breaker-${index}-kind` ? (
                          <>
                            <MicOff size={12} />
                            <span>중지</span>
                          </>
                        ) : (
                          <>
                            <Mic size={12} />
                            <span>음성</span>
                          </>
                        )}
                      </button>
                    </div>
                    <select 
                      value={breaker.kind} 
                      onChange={(e) => handleBreakerChange(index, 'kind', e.target.value as 'MCCB' | 'ELB')}
                      className={`w-full rounded border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer bg-white ${
                        isListening && activeVoiceField === `breaker-${index}-kind` ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      style={{ pointerEvents: 'auto', zIndex: 9999, position: 'relative' }}
                    >
                      <option value="MCCB">MCCB</option>
                      <option value="ELB">ELB</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">형식</label>
                      <button
                        type="button"
                        onClick={() => toggleListening(`breaker-${index}-type`)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          isListening && activeVoiceField === `breaker-${index}-type`
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                        }`}
                      >
                        {isListening && activeVoiceField === `breaker-${index}-type` ? (
                          <>
                            <MicOff size={12} />
                            <span>중지</span>
                          </>
                        ) : (
                          <>
                            <Mic size={12} />
                            <span>음성</span>
                          </>
                        )}
                      </button>
                    </div>
                    <select 
                      value={breaker.type || '1P'} 
                      onChange={(e) => handleBreakerChange(index, 'type', e.target.value)}
                      className={`w-full rounded border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none cursor-pointer bg-white ${
                        isListening && activeVoiceField === `breaker-${index}-type` ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      style={{ pointerEvents: 'auto', zIndex: 9999, position: 'relative' }}
                    >
                      <option value="1P">1P</option>
                      <option value="2P">2P</option>
                      <option value="3P">3P</option>
                      <option value="4P">4P</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-slate-600">부하명</label>
                      <button
                        type="button"
                        onClick={() => toggleListening(`breaker-${index}-loadName`)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                          isListening && activeVoiceField === `breaker-${index}-loadName`
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                        }`}
                      >
                        {isListening && activeVoiceField === `breaker-${index}-loadName` ? (
                          <>
                            <MicOff size={12} />
                            <span>중지</span>
                          </>
                        ) : (
                          <>
                            <Mic size={12} />
                            <span>음성</span>
                          </>
                        )}
                      </button>
                    </div>
                    <input 
                      type="text" 
                      value={breaker.loadName} 
                      onChange={(e) => handleBreakerChange(index, 'loadName', e.target.value)}
                      className={`w-full rounded border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none ${
                        isListening && activeVoiceField === `breaker-${index}-loadName` ? 'border-red-300 bg-red-50' : 'border-slate-300'
                      }`}
                      placeholder="고정부하, 이동부하X"
                    />
                  </div>
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-600 mb-2">전류 (A) - 후크메가</label>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">L1</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={breaker.currentL1} 
                        onChange={(e) => handleBreakerChange(index, 'currentL1', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">L2</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={breaker.currentL2} 
                        onChange={(e) => handleBreakerChange(index, 'currentL2', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">L3</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={breaker.currentL3} 
                        onChange={(e) => handleBreakerChange(index, 'currentL3', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">부하 용량[W]</label>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">R</label>
                      <input 
                        type="number" 
                        value={breaker.loadCapacityR} 
                        onChange={(e) => handleBreakerChange(index, 'loadCapacityR', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">S</label>
                      <input 
                        type="number" 
                        value={breaker.loadCapacityS} 
                        onChange={(e) => handleBreakerChange(index, 'loadCapacityS', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">T</label>
                      <input 
                        type="number" 
                        value={breaker.loadCapacityT} 
                        onChange={(e) => handleBreakerChange(index, 'loadCapacityT', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">N</label>
                      <input 
                        type="number" 
                        value={breaker.loadCapacityN} 
                        onChange={(e) => handleBreakerChange(index, 'loadCapacityN', parseFloat(e.target.value) || 0)}
                        className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {(!formData.breakers || formData.breakers.length === 0) && (
              <p className="text-sm text-slate-500 text-center py-4">차단기 정보를 추가해주세요</p>
            )}
          </div>
        </div>

        {/* 접지 정보 */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">접지 (외관 점검)</label>
          <select 
            value={formData.grounding || '미점검'} 
            onChange={handleGroundingChange}
            className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none cursor-pointer bg-white"
            style={{ pointerEvents: 'auto', zIndex: 9999, position: 'relative' }}
          >
            <option value="양호">양호</option>
            <option value="불량">불량</option>
            <option value="미점검">미점검</option>
          </select>
        </div>

        {/* 열화상 측정 섹션 */}
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Thermometer size={20} className="text-red-600" />
              열화상 측정
            </h3>
          </div>
          
          <div className="mb-3">
            <label className="block text-sm font-semibold text-slate-700 mb-2">측정기</label>
            <input 
              type="text" 
              value={formData.thermalImage?.equipment || 'KT-352'} 
              onChange={(e) => handleThermalImageDataChange('equipment', e.target.value)}
              className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          <div className="mb-3">
            <label className="block text-sm font-semibold text-slate-700 mb-2">점검 내용</label>
            <input 
              type="text" 
              value="변대/가설분전반 전류 및 발열" 
              disabled
              className="w-full rounded-lg border-slate-200 border px-3 py-2 bg-slate-50 text-slate-500"
            />
          </div>

          <div className="mb-3">
            <label className="block text-sm font-semibold text-slate-700 mb-2">열화상 이미지</label>
            <div className="relative group">
              {formData.thermalImage?.imageUrl ? (
                <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center" style={{ height: '200px' }}>
                  <img src={formData.thermalImage.imageUrl} alt="Thermal Image" className="h-full w-auto object-contain" />
                  <button 
                    onClick={() => setFormData(prev => ({ ...prev, thermalImage: { ...prev.thermalImage, imageUrl: null } as ThermalImageData }))}
                    className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Upload size={14} className="rotate-45" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="flex flex-col items-center justify-center pt-3 pb-4">
                    <Camera className="w-6 h-6 text-slate-400 mb-1" />
                    <p className="text-xs text-slate-500">열화상 이미지 업로드</p>
                  </div>
                  <input type="file" className="hidden" accept="image/*" onChange={handleThermalImageUpload} />
                </label>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">온도 측정값 (°C)</label>
              <input 
                type="number" 
                step="0.1"
                value={formData.thermalImage?.temperature || 0} 
                onChange={(e) => handleThermalImageDataChange('temperature', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">방사율 (e)</label>
              <input 
                type="number" 
                step="0.01"
                value={formData.thermalImage?.emissivity || 0.95} 
                onChange={(e) => handleThermalImageDataChange('emissivity', parseFloat(e.target.value) || 0.95)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">최대 온도 (°C)</label>
              <input 
                type="number" 
                step="0.1"
                value={formData.thermalImage?.maxTemp || 0} 
                onChange={(e) => handleThermalImageDataChange('maxTemp', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">최소 온도 (°C)</label>
              <input 
                type="number" 
                step="0.1"
                value={formData.thermalImage?.minTemp || 0} 
                onChange={(e) => handleThermalImageDataChange('minTemp', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">측정 시간</label>
              <input 
                type="text" 
                value={formData.thermalImage?.measurementTime || ''} 
                onChange={(e) => handleThermalImageDataChange('measurementTime', e.target.value)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                placeholder="예: 17:00"
              />
            </div>
          </div>
        </div>

        {/* 부하 합계 정보 */}
        <div className="border border-slate-200 rounded-lg p-4">
          <h3 className="text-lg font-bold text-slate-800 mb-4">부하 합계 정보</h3>
          
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">상별 부하 합계 [AV] A</label>
              <input 
                type="number" 
                value={formData.loadSummary?.phaseLoadSumA || 0} 
                onChange={(e) => handleLoadSummaryChange('phaseLoadSumA', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">상별 부하 합계 [AV] B</label>
              <input 
                type="number" 
                value={formData.loadSummary?.phaseLoadSumB || 0} 
                onChange={(e) => handleLoadSummaryChange('phaseLoadSumB', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">상별 부하 합계 [AV] C</label>
              <input 
                type="number" 
                value={formData.loadSummary?.phaseLoadSumC || 0} 
                onChange={(e) => handleLoadSummaryChange('phaseLoadSumC', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">총 연결 부하 합계[AV]</label>
              <input 
                type="number" 
                step="0.01"
                value={formData.loadSummary?.totalLoadSum || 0} 
                onChange={(e) => handleLoadSummaryChange('totalLoadSum', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">상별 부하 분담 [%] A</label>
              <input 
                type="number" 
                step="0.1"
                value={formData.loadSummary?.phaseLoadShareA || 0} 
                onChange={(e) => handleLoadSummaryChange('phaseLoadShareA', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">상별 부하 분담 [%] B</label>
              <input 
                type="number" 
                step="0.1"
                value={formData.loadSummary?.phaseLoadShareB || 0} 
                onChange={(e) => handleLoadSummaryChange('phaseLoadShareB', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">상별 부하 분담 [%] C</label>
              <input 
                type="number" 
                step="0.1"
                value={formData.loadSummary?.phaseLoadShareC || 0} 
                onChange={(e) => handleLoadSummaryChange('phaseLoadShareC', parseFloat(e.target.value) || 0)}
                className="w-full rounded border-slate-300 border px-2 py-1.5 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Site Photo Section */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <label className="block text-sm font-semibold text-slate-700">현장 사진</label>
            {formData.photoUrl && (
              <button
                onClick={handleAnalyzePhoto}
                disabled={isAnalyzing}
                className="text-xs flex items-center gap-1.5 bg-purple-100 text-purple-700 px-3 py-1.5 rounded-full hover:bg-purple-200 transition-colors disabled:opacity-50"
              >
                {isAnalyzing ? (
                  <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  <Sparkles size={14} />
                )}
                {isAnalyzing ? '분석 중...' : 'AI 분석'}
              </button>
            )}
          </div>
          
          <div className="relative group">
            {formData.photoUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center" style={{ height: '214px' }}>
                <img src={formData.photoUrl} alt="Inspection Site" className="h-full w-auto object-contain" />
                <button 
                  onClick={() => setFormData(prev => ({ ...prev, photoUrl: null }))}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                >
                  <Upload size={14} className="rotate-45" />
                </button>
                {aiMessage && (
                   <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-md text-white text-xs p-2 text-center animate-fade-in">
                     {aiMessage}
                   </div>
                )}
              </div>
            ) : (
              <label 
                className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors"
                onDrop={handlePhotoDrop}
                onDragOver={handlePhotoDragOver}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Camera className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500">사진을 업로드하거나 드래그하세요</p>
                  <p className="text-xs text-slate-400 mt-1">(최대 10MB)</p>
                </div>
                <input 
                  ref={fileInputRef}
                  type="file" 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handlePhotoUpload} 
                />
              </label>
            )}
          </div>
        </div>


        {/* Memo */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-semibold text-slate-700">점검 조치 사항</label>
            <button
              type="button"
              onClick={() => toggleListening('memo')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isListening && activeVoiceField === 'memo'
                  ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
              }`}
            >
              {isListening && activeVoiceField === 'memo' ? (
                <>
                  <MicOff size={16} />
                  <span>녹음 중지</span>
                </>
              ) : (
                <>
                  <Mic size={16} />
                  <span>음성 입력</span>
                </>
              )}
            </button>
          </div>
          <textarea
            value={formData.memo}
            onChange={handleMemoChange}
            className={`w-full h-24 rounded-lg border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none resize-none ${
              isListening && activeVoiceField === 'memo' ? 'border-red-300 bg-red-50' : 'border-slate-300'
            }`}
            placeholder="특정 문제나 조치 사항을 입력하세요... 또는 음성 입력을 사용하세요"
          />
          {isListening && activeVoiceField === 'memo' && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              녹음 중...
            </p>
          )}
      </div>

      {/* Footer Actions */}
        <div className="pt-4 flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 px-4 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-white hover:shadow-sm transition-all"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(formData)}
          className="flex-1 py-2.5 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2"
        >
          <Save size={18} />
          Save
        </button>
        <button
          onClick={() => onGenerateReport?.(formData)}
          disabled={formData.status !== 'Complete'}
          className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
          title={formData.status !== 'Complete' ? '상태가 Complete일 때만 보고서를 생성할 수 있습니다.' : '보고서 생성'}
        >
          <FileText size={18} />
          Report Generate
        </button>
        </div>

      </div>
    </div>
  );
};

export default InspectionDetail;