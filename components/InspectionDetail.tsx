import React, { useState, useEffect, useRef } from 'react';
import { InspectionRecord, Loads } from '../types';
import { Save, FileText, Camera, Upload, Sparkles, AlertCircle, CheckCircle2, Mic, MicOff } from 'lucide-react';
import { analyzeInspectionPhoto } from '../services/geminiService';

interface InspectionDetailProps {
  record: InspectionRecord;
  onSave: (updatedRecord: InspectionRecord) => void;
  onCancel: () => void;
}

const InspectionDetail: React.FC<InspectionDetailProps> = ({ record, onSave, onCancel }) => {
  const [formData, setFormData] = useState<InspectionRecord>(record);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const lastTranscriptRef = useRef<string>('');
  const processedResultsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    setFormData(record);
    setAiMessage(null);
  }, [record]);

  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // 중복 방지를 위해 false로 변경
      recognition.interimResults = true;
      recognition.lang = 'ko-KR'; // 한글 지원

      recognition.onresult = (event: SpeechRecognitionEvent) => {
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
          
          setFormData(prev => ({
            ...prev,
            memo: (prev.memo ? prev.memo + ' ' : '') + newText
          }));
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        processedResultsRef.current.clear();
        lastTranscriptRef.current = '';
        
        if (event.error === 'not-allowed') {
          alert('Microphone permission denied. Please allow microphone access.');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        // 인식이 끝나면 처리된 결과 초기화
        processedResultsRef.current.clear();
      };

      recognition.onstart = () => {
        // 새로운 인식 시작 시 초기화
        processedResultsRef.current.clear();
        lastTranscriptRef.current = '';
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      processedResultsRef.current.clear();
      lastTranscriptRef.current = '';
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      processedResultsRef.current.clear();
      lastTranscriptRef.current = '';
    } else {
      try {
        // 초기화 후 시작
        processedResultsRef.current.clear();
        lastTranscriptRef.current = '';
        recognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        setIsListening(false);
      }
    }
  };

  const handleLoadChange = (key: keyof Loads) => {
    setFormData(prev => ({
      ...prev,
      loads: {
        ...prev.loads,
        [key]: !prev.loads[key]
      }
    }));
  };

  const handleMemoChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, memo: e.target.value }));
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, status: e.target.value as InspectionRecord['status'] }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photoUrl: reader.result as string }));
        setAiMessage(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyzePhoto = async () => {
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
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Complete': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'In Progress': return 'text-blue-600 bg-blue-50 border-blue-200';
      default: return 'text-slate-600 bg-slate-50 border-slate-200';
    }
  };

  return (
    <div className="bg-white h-full flex flex-col shadow-xl border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-slate-200 text-slate-600 px-2 py-1 rounded text-sm">ID</span>
            {formData.id}
          </h2>
          <p className="text-sm text-slate-500 mt-1">Inspection Details</p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusColor(formData.status)}`}>
          {formData.status}
        </div>
      </div>

      <div className="flex-[0.8] overflow-y-auto p-4 space-y-6">
        
        {/* Status & Date */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Inspection Status</label>
            <select 
              value={formData.status} 
              onChange={handleStatusChange}
              className="w-full rounded-lg border-slate-300 border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            >
              <option value="Complete">Complete</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending">Pending</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Last Inspected</label>
            <input 
              type="text" 
              disabled 
              value={formData.lastInspectionDate} 
              className="w-full rounded-lg border-slate-200 border px-3 py-2 bg-slate-50 text-slate-500"
            />
          </div>
        </div>

        {/* Connected Loads */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-3">Connected Loads</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'welder', label: 'Welder' },
              { key: 'grinder', label: 'Grinder' },
              { key: 'light', label: 'Temp Light' },
              { key: 'pump', label: 'Water Pump' }
            ].map((item) => (
              <label 
                key={item.key}
                className={`
                  flex items-center p-3 rounded-lg border cursor-pointer transition-all
                  ${formData.loads[item.key as keyof Loads] 
                    ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}
                `}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={formData.loads[item.key as keyof Loads]}
                  onChange={() => handleLoadChange(item.key as keyof Loads)}
                />
                <div className={`w-5 h-5 rounded border mr-3 flex items-center justify-center ${formData.loads[item.key as keyof Loads] ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                  {formData.loads[item.key as keyof Loads] && <CheckCircle2 size={14} className="text-white" />}
                </div>
                <span className="font-medium">{item.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Photo Section */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <label className="block text-sm font-semibold text-slate-700">Site Photo</label>
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
                {isAnalyzing ? 'Analyzing...' : 'AI Analyze'}
              </button>
            )}
          </div>
          
          <div className="relative group">
            {formData.photoUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[32/9]">
                <img src={formData.photoUrl} alt="Inspection Site" className="w-full h-full object-cover" />
                <button 
                  onClick={() => setFormData(prev => ({ ...prev, photoUrl: null }))}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                >
                  <Upload size={14} className="rotate-45" /> {/* Close Icon Simulation */}
                </button>
                {aiMessage && (
                   <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-md text-white text-xs p-2 text-center animate-fade-in">
                     {aiMessage}
                   </div>
                )}
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Camera className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500">Click to upload or drag photo</p>
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
              </label>
            )}
          </div>
        </div>

        {/* Memo */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-semibold text-slate-700">Observations & Actions</label>
            <button
              type="button"
              onClick={toggleListening}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isListening
                  ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff size={16} />
                  <span>Stop Recording</span>
                </>
              ) : (
                <>
                  <Mic size={16} />
                  <span>Voice Input</span>
                </>
              )}
            </button>
          </div>
          <textarea
            value={formData.memo}
            onChange={handleMemoChange}
            className={`w-full h-24 rounded-lg border px-3 py-2 text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none resize-none ${
              isListening ? 'border-red-300 bg-red-50' : 'border-slate-300'
            }`}
            placeholder="Enter any specific issues or corrective actions taken... or use voice input"
          />
          {isListening && (
            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              Listening...
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
            className="flex-[2] py-2.5 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2"
          >
            <Save size={18} />
            Save & Generate Report
          </button>
        </div>

      </div>
    </div>
  );
};

export default InspectionDetail;