
import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";

// --- Types ---
type Provider = 'gemini' | 'grok';

interface ApiKeyEntry {
    id: string;
    key: string;
    label: string;
    isActive: boolean;
    createdAt: number;
}

interface ApiSettings {
    provider: Provider;
    keys: {
        gemini: ApiKeyEntry[];
        grok: ApiKeyEntry[];
    };
    models: {
        gemini: string;
        grok: string;
    };
}

// --- Constants ---
const DEFAULT_SETTINGS: ApiSettings = {
    provider: 'gemini',
    keys: {
        gemini: process.env.API_KEY 
            ? [{ id: 'env-key', key: process.env.API_KEY, label: 'System Env', isActive: true, createdAt: Date.now() }] 
            : [],
        grok: []
    },
    models: {
        gemini: 'gemini-3-pro-image-preview',
        grok: 'grok-4-1-fast-reasoning'
    }
};

const MODEL_OPTIONS = {
    gemini: [
        { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (Nano Banana Pro - Chuyên Ảnh)' },
        { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (Mạnh nhất - Suy luận & Code)' },
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Tối ưu tốc độ & Chi phí)' }
    ],
    grok: [
        { value: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast (Reasoning - Suy luận sâu)' },
        { value: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast (Instant - Tốc độ cao)' }
    ]
};

// --- Helper Functions ---
// Enhanced fileToGenerativePart with robust validation and detailed logging
const fileToGenerativePart = async (input: unknown, context: string = ''): Promise<{ inlineData: { data: string; mimeType: string } } | null> => {
    // Safe logging without stringify
    const typeInfo = {
        type: typeof input,
        constructorName: input?.constructor?.name,
        isNull: input === null,
        isUndefined: input === undefined,
        isFile: input instanceof File,
        isBlob: input instanceof Blob,
        isString: typeof input === 'string',
        tagName: input instanceof Element ? (input as Element).tagName : null
    };
    console.log(`[fileToGenerativePart ${context}] Input info:`, typeInfo);

    if (input === null) {
        console.error('[fileToGenerativePart] Input is null');
        throw new Error('Input is null');
    }

    if (input === undefined) {
        console.error('[fileToGenerativePart] Input is undefined');
        throw new Error('Input is undefined');
    }

    // Handle File object
    if (input instanceof File) {
        console.log('[fileToGenerativePart] Processing File:', input.name, 'size:', input.size, 'type:', input.type);
        if (input.size === 0) {
            throw new Error('File is empty (size: 0)');
        }

        const blob = input as File;
        const base64EncodedDataPromise = new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (reader.result) {
                    resolve((reader.result as string).split(',')[1]);
                } else {
                    reject(new Error('Failed to read file'));
                }
            };
            reader.onerror = () => {
                reject(new Error('Failed to read file: ' + (reader.error?.message || 'Unknown error')));
            };
            reader.readAsDataURL(blob);
        });

        return {
            inlineData: {
                data: await base64EncodedDataPromise,
                mimeType: blob.type || 'image/png'
            },
        };
    }

    // Handle Blob object
    if (input instanceof Blob) {
        console.log('[fileToGenerativePart] Processing Blob:', 'size:', input.size, 'type:', input.type);

        const base64EncodedDataPromise = new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (reader.result) {
                    resolve((reader.result as string).split(',')[1]);
                } else {
                    reject(new Error('Failed to read blob'));
                }
            };
            reader.onerror = () => {
                reject(new Error('Failed to read blob: ' + (reader.error?.message || 'Unknown error')));
            };
            reader.readAsDataURL(input);
        });

        return {
            inlineData: {
                data: await base64EncodedDataPromise,
                mimeType: input.type || 'image/png'
            },
        };
    }

    // Handle string (data URL or other)
    if (typeof input === 'string') {
        console.log('[fileToGenerativePart] Input is a string, length:', input.length);
        if (input.startsWith('data:')) {
            // It's a data URL
            const base64 = input.split(',')[1];
            const mimeType = input.match(/^data:(.+);/)?.[1] || 'image/png';
            return {
                inlineData: {
                    data: base64,
                    mimeType: mimeType
                },
            };
        } else {
            // It's a regular URL
            console.log('[fileToGenerativePart] Fetching URL:', input.substring(0, 100) + '...');
            try {
                const response = await fetch(input);
                const blob = await response.blob();
                console.log('[fileToGenerativePart] Fetched blob:', blob.size, blob.type);
                return fileToGenerativePart(blob, context + '-fetched');
            } catch (err) {
                console.error('[fileToGenerativePart] Failed to fetch URL:', err);
                throw new Error('Failed to fetch image from URL: ' + input.substring(0, 50) + '...');
            }
        }
    }

    // DEBUG: Unknown object type - try to diagnose safely
    if (typeof input === 'object') {
        // Check if it's a DOM element or React component
        if (input instanceof Element) {
            console.error('[fileToGenerativePart] Input is a DOM Element:', (input as Element).tagName);
            throw new Error(`Input is a DOM Element (${(input as Element).tagName}), not a File or Blob!`);
        }

        // Check for common problematic types
        const constructorName = input.constructor?.name;
        if (constructorName && !['Object', 'Array'].includes(constructorName)) {
            console.error('[fileToGenerativePart] Unknown object type:', constructorName);
        }

        // Check properties safely
        const hasSize = 'size' in input;
        const hasType = 'type' in input;
        const hasName = 'name' in input;
        console.log('[fileToGenerativePart] Object properties:', { hasSize, hasType, hasName });

        // Try to convert if it has size/type
        if (hasSize && hasType) {
            try {
                const sizeValue = (input as Record<string, unknown>).size;
                const typeValue = (input as Record<string, unknown>).type;
                console.log('[fileToGenerativePart] Attempting conversion with size:', sizeValue, 'type:', typeValue);

                if ('arrayBuffer' in input && typeof (input as { arrayBuffer: () => Promise<unknown> }).arrayBuffer === 'function') {
                    try {
                        const arrayBuffer = await (input as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
                        const blob = new Blob([arrayBuffer], { type: String(typeValue || 'image/png') });
                        return fileToGenerativePart(blob, context + '-converted');
                    } catch (e) {
                        console.error('[fileToGenerativePart] arrayBuffer conversion failed:', e);
                    }
                }
            } catch (e) {
                console.error('[fileToGenerativePart] Conversion failed:', e);
            }
        }

        throw new Error(`Input is not a File or Blob. Constructor: ${constructorName || 'unknown'}. Check console for details.`);
    }

    // Handle other cases
    console.error('[fileToGenerativePart] Input type not recognized:', typeof input);
    throw new Error(`Input is not a File or Blob. Received type: ${typeof input}`);
};

const urlToGenerativePart = async (url: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (reader.result) {
                resolve((reader.result as string).split(',')[1]);
            } else {
                reject(new Error('Failed to read blob'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
    });
    return {
        inlineData: { data: base64, mimeType: blob.type },
    };
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const extractGenAiErrorInfo = (err: unknown) => {
    const anyErr = err as any;
    const message = typeof anyErr?.message === 'string' ? anyErr.message : String(err);
    const code = anyErr?.code ?? anyErr?.error?.code;
    const status = anyErr?.status ?? anyErr?.error?.status;
    return { message, code, status };
};

const isOverloadedError = (err: unknown) => {
    const { message, code, status } = extractGenAiErrorInfo(err);
    return code === 503 || status === 'UNAVAILABLE' || /overloaded|unavailable|503/i.test(message);
};

const generateImageWithRetry = async ({
    ai,
    model,
    contents,
    config,
    fallbackModels = [],
    retryDelaysMs = [800, 1600, 3200],
}: {
    ai: GoogleGenAI;
    model: string;
    contents: any;
    config: any;
    fallbackModels?: string[];
    retryDelaysMs?: number[];
}) => {
    const tryModel = async (modelName: string) => {
        for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
            try {
                return await ai.models.generateContent({ model: modelName, contents, config });
            } catch (err) {
                if (isOverloadedError(err) && attempt < retryDelaysMs.length) {
                    await delay(retryDelaysMs[attempt]);
                    continue;
                }
                throw err;
            }
        }
    };

    try {
        return await tryModel(model);
    } catch (err) {
        if (!isOverloadedError(err)) throw err;
        const uniqueFallbacks = fallbackModels.filter((m, i, arr) => m && m !== model && arr.indexOf(m) === i);
        let lastErr = err;
        for (const fallback of uniqueFallbacks) {
            try {
                return await tryModel(fallback);
            } catch (fallbackErr) {
                lastErr = fallbackErr;
                if (!isOverloadedError(fallbackErr)) throw fallbackErr;
            }
        }
        throw lastErr;
    }
};

// Mask API Key for display
const maskKey = (key: string) => {
    if (key.length <= 8) return '********';
    return `${key.slice(0, 4)}...${key.slice(-4)}`;
};

// --- Components ---

// Settings Modal Component - Enhanced with Bulk API Input
const SettingsModal = ({
    isOpen,
    onClose,
    settings,
    onSave
}: {
    isOpen: boolean;
    onClose: () => void;
    settings: ApiSettings;
    onSave: (newSettings: ApiSettings) => void;
}) => {
    const [localSettings, setLocalSettings] = useState<ApiSettings>(settings);
    const [newKeyInput, setNewKeyInput] = useState('');
    const [newKeyLabel, setNewKeyLabel] = useState('');
    const [bulkKeysInput, setBulkKeysInput] = useState('');
    const [showBulkInput, setShowBulkInput] = useState(false);

    // Sync local state when modal opens
    useEffect(() => {
        if (isOpen) {
            setLocalSettings(settings);
            setNewKeyInput('');
            setNewKeyLabel('');
            setBulkKeysInput('');
            setShowBulkInput(false);
        }
    }, [isOpen, settings]);

    if (!isOpen) return null;

    const currentProviderKeys = localSettings.keys[localSettings.provider];

    const handleModelChange = (provider: Provider, value: string) => {
        setLocalSettings(prev => ({
            ...prev,
            models: { ...prev.models, [provider]: value }
        }));
    };

    const handleAddKey = () => {
        if (!newKeyInput.trim()) return;

        const newEntry: ApiKeyEntry = {
            id: crypto.randomUUID(),
            key: newKeyInput.trim(),
            label: newKeyLabel.trim() || `Key ${currentProviderKeys.length + 1}`,
            isActive: currentProviderKeys.length === 0,
            createdAt: Date.now()
        };

        setLocalSettings(prev => ({
            ...prev,
            keys: {
                ...prev.keys,
                [prev.provider]: [...prev.keys[prev.provider], newEntry]
            }
        }));

        setNewKeyInput('');
        setNewKeyLabel('');
    };

    const handleBulkImport = () => {
        if (!bulkKeysInput.trim()) return;

        // Parse multiple keys (split by newlines or commas)
        const keyPatterns = bulkKeysInput.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 0);

        const newKeys: ApiKeyEntry[] = keyPatterns.map((key, index) => ({
            id: crypto.randomUUID(),
            key: key,
            label: `Bulk Key ${currentProviderKeys.length + index + 1}`,
            isActive: currentProviderKeys.length === 0 && index === 0,
            createdAt: Date.now()
        }));

        setLocalSettings(prev => ({
            ...prev,
            keys: {
                ...prev.keys,
                [prev.provider]: [...prev.keys[prev.provider], ...newKeys]
            }
        }));

        setBulkKeysInput('');
        setShowBulkInput(false);
    };

    const handleDeleteKey = (id: string) => {
        setLocalSettings(prev => {
            const updatedKeys = prev.keys[localSettings.provider].filter(k => k.id !== id);
            if (updatedKeys.length > 0 && !updatedKeys.some(k => k.isActive)) {
                updatedKeys[0].isActive = true;
            }
            return {
                ...prev,
                keys: {
                    ...prev.keys,
                    [localSettings.provider]: updatedKeys
                }
            };
        });
    };

    const handleSetActiveKey = (id: string) => {
        setLocalSettings(prev => ({
            ...prev,
            keys: {
                ...prev.keys,
                [localSettings.provider]: prev.keys[localSettings.provider].map(k => ({
                    ...k,
                    isActive: k.id === id
                }))
            }
        }));
    };

    const handleClearAllKeys = () => {
        if (window.confirm('Bạn có chắc muốn xóa tất cả API Keys không?')) {
            setLocalSettings(prev => ({
                ...prev,
                keys: {
                    ...prev.keys,
                    [localSettings.provider]: []
                }
            }));
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-large">
                <div className="modal-header">
                    <h2>⚙️ Quản lý API & Model</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {/* Provider Selection */}
                    <div className="form-group">
                        <label>Chọn Nhà Cung Cấp (Provider):</label>
                        <div className="provider-tabs">
                            {(['gemini', 'grok'] as Provider[]).map(p => (
                                <button
                                    key={p}
                                    className={`tab-btn small ${localSettings.provider === p ? 'active' : ''}`}
                                    onClick={() => setLocalSettings(prev => ({ ...prev, provider: p }))}
                                >
                                    {p.charAt(0).toUpperCase() + p.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>

                    <hr className="divider" />

                    <div className="provider-settings active-section">
                        <h3>Cấu hình {localSettings.provider.charAt(0).toUpperCase() + localSettings.provider.slice(1)}</h3>

                        {/* API Key Management */}
                        <div className="api-management-section">
                            <div className="api-header">
                                <label style={{display: 'block', color: '#aaa', fontSize: '0.9rem'}}>Danh sách API Keys ({currentProviderKeys.length} keys)</label>
                                <div className="api-header-actions">
                                    <button
                                        className="btn btn-small"
                                        onClick={() => setShowBulkInput(!showBulkInput)}
                                    >
                                        📋 Nhập nhiều Keys
                                    </button>
                                    {currentProviderKeys.length > 0 && (
                                        <button
                                            className="btn btn-small btn-danger"
                                            onClick={handleClearAllKeys}
                                            title="Xóa tất cả"
                                        >
                                            🗑️ Xóa tất cả
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Bulk Import Section */}
                            {showBulkInput && (
                                <div className="bulk-import-section">
                                    <label>Nhập nhiều API Keys (mỗi key một dòng hoặc ngăn cách bằng dấu phẩy):</label>
                                    <textarea
                                        className="bulk-keys-textarea"
                                        placeholder={`AIzaSy...\nAIzaSy...`}
                                        value={bulkKeysInput}
                                        onChange={(e) => setBulkKeysInput(e.target.value)}
                                        rows={5}
                                    />
                                    <div className="bulk-import-actions">
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => setShowBulkInput(false)}
                                        >
                                            Hủy
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleBulkImport}
                                            disabled={!bulkKeysInput.trim()}
                                        >
                                            Nhập Keys ({bulkKeysInput.split(/[\n,]+/).filter(k => k.trim()).length})
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Key List */}
                            <div className="key-list">
                                {currentProviderKeys.length === 0 ? (
                                    <div className="empty-keys">Chưa có API Key nào. Vui lòng thêm mới.</div>
                                ) : (
                                    currentProviderKeys.map(entry => (
                                        <div key={entry.id} className={`key-item ${entry.isActive ? 'active-key' : ''}`}>
                                            <div className="key-info" onClick={() => handleSetActiveKey(entry.id)}>
                                                <div className={`radio-indicator ${entry.isActive ? 'checked' : ''}`}></div>
                                                <div className="key-text">
                                                    <span className="key-label">{entry.label}</span>
                                                    <span className="key-value">{maskKey(entry.key)}</span>
                                                </div>
                                            </div>
                                            <button className="delete-key-btn" onClick={() => handleDeleteKey(entry.id)} title="Xóa key">
                                                🗑️
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Single Key Add Form */}
                            {!showBulkInput && (
                                <div className="add-key-form">
                                    <input
                                        type="text"
                                        placeholder="Tên gợi nhớ (Ví dụ: Personal, Project A)..."
                                        value={newKeyLabel}
                                        onChange={(e) => setNewKeyLabel(e.target.value)}
                                        className="key-label-input"
                                    />
                                    <div className="input-with-btn">
                                        <input
                                            type="password"
                                            placeholder={`Nhập ${localSettings.provider} API Key mới...`}
                                            value={newKeyInput}
                                            onChange={(e) => setNewKeyInput(e.target.value)}
                                            className="key-value-input"
                                        />
                                        <button className="btn btn-secondary add-btn" onClick={handleAddKey} disabled={!newKeyInput}>
                                            + Thêm
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Model Selection */}
                        <div className="form-group" style={{marginTop: '1.5rem'}}>
                            <label>Chọn Model Mặc Định:</label>
                            <select
                                value={localSettings.models[localSettings.provider]}
                                onChange={(e) => handleModelChange(localSettings.provider, e.target.value)}
                            >
                                {MODEL_OPTIONS[localSettings.provider].map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Hủy</button>
                    <button className="btn btn-primary" onClick={() => onSave(localSettings)}>Lưu Cấu Hình</button>
                </div>
            </div>
        </div>
    );
};

const GuideModal = ({
    isOpen,
    onClose
}: {
    isOpen: boolean;
    onClose: () => void;
}) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content modal-large">
                <div className="modal-header">
                    <h2>📘 Hướng dẫn sử dụng</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body guide-body">
                    <div className="guide-section">
                        <h3>👗 Virtual Try-On</h3>
                        <p><strong>Chức năng:</strong> Ghép trang phục (áo/quần/váy/giày/phụ kiện) lên ảnh người mẫu.</p>
                        <p><strong>Điểm mạnh:</strong> Giữ khuôn mặt & dáng người ổn định, hỗ trợ fullset + ảnh tham chiếu, kiểm soát nền & tỉ lệ ảnh.</p>
                    </div>

                    <div className="guide-section">
                        <h3>✨ Fix da nhựa</h3>
                        <p><strong>Chức năng:</strong> Khử hiệu ứng da nhựa, phục hồi texture da tự nhiên.</p>
                        <p><strong>Điểm mạnh:</strong> Giữ chi tiết khuôn mặt, tái tạo lỗ chân lông và ánh sáng mềm mại.</p>
                    </div>

                    <div className="guide-section">
                        <h3>👙 Nâng ngực</h3>
                        <p><strong>Chức năng:</strong> Điều chỉnh tỉ lệ vòng một tự nhiên trên ảnh người mẫu.</p>
                        <p><strong>Điểm mạnh:</strong> Hạn chế méo nền, giữ trang phục & dáng người hài hòa.</p>
                    </div>

                    <div className="guide-section">
                        <h3>🔄 Swap Face</h3>
                        <p><strong>Chức năng:</strong> Thay khuôn mặt từ ảnh nguồn sang ảnh đích.</p>
                        <p><strong>Điểm mạnh:</strong> Bảo toàn ánh sáng, màu da, biểu cảm gần tự nhiên.</p>
                    </div>

                    <div className="guide-section">
                        <h3>👤 AI Influencer</h3>
                        <p><strong>Chức năng:</strong> Tạo nhân vật influencer theo giới tính, tuổi, phong cách, bối cảnh.</p>
                        <p><strong>Điểm mạnh:</strong> Có ảnh tham chiếu tùy chọn, điều khiển khung hình, prompt tùy chỉnh.</p>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-primary" onClick={onClose}>Đóng</button>
                </div>
            </div>
        </div>
    );
};

const ImageUploader = ({
    image,
    onImageSelect,
    onRemove,
    children,
    isLoading = false,
    loadingText = '',
    label = ''
}: {
    image: string | null;
    onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemove?: () => void;
    children?: React.ReactNode;
    isLoading?: boolean;
    loadingText?: string;
    label?: string;
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAreaClick = (e: React.MouseEvent) => {
        // Prevent trigger if clicking the remove button
        if ((e.target as HTMLElement).closest('.remove-btn')) return;
        if (!isLoading) {
            fileInputRef.current?.click();
        }
    };

    return (
        <div className="uploader-wrapper">
            {label && <label className="uploader-label">{label}</label>}
            <div className="image-upload-area" onClick={handleAreaClick} role="button" tabIndex={0} aria-label="Image upload area">
                {image ? (
                    <>
                        <img src={image} alt="Preview" />
                        {onRemove && !isLoading && (
                            <button className="remove-btn" onClick={onRemove} title="Xóa ảnh">
                                &times;
                            </button>
                        )}
                    </>
                ) : children}
                {isLoading && (
                    <div className="loader-container">
                        <div className="spinner"></div>
                        <p>{loadingText}</p>
                    </div>
                )}
                <input
                    type="file"
                    accept="image/*"
                    className="hidden-file-input"
                    ref={fileInputRef}
                    onChange={onImageSelect}
                    disabled={isLoading}
                />
            </div>
        </div>
    );
};

// Magnifier Image Component with Zoom and Pan
interface MagnifierImageProps {
    src: string;
    alt: string;
    zoomLevel?: number;
    showMagnifier?: boolean;
    containerClass?: string;
}

const MagnifierImage = ({
    src,
    alt,
    zoomLevel = 2,
    showMagnifier = true,
    containerClass = ''
}: MagnifierImageProps) => {
    const [isZoomed, setIsZoomed] = useState(false);
    const [position, setPosition] = useState({ x: 50, y: 50 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        setPosition({ x, y });
    };

    const handleMouseEnter = () => {
        if (zoomLevel > 1) {
            setIsZoomed(true);
        }
    };

    const handleMouseLeave = () => {
        setIsZoomed(false);
        setPosition({ x: 50, y: 50 });
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isZoomed) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseMovePan = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        let newX = e.clientX - dragStart.x;
        let newY = e.clientY - dragStart.y;

        // Constrain to 0-100%
        newX = Math.max(0, Math.min(100, newX));
        newY = Math.max(0, Math.min(100, newY));

        setPosition({ x: newX, y: newY });
    };

    const toggleZoom = () => {
        setIsZoomed(!isZoomed);
        if (isZoomed) {
            setPosition({ x: 50, y: 50 });
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        if (e.deltaY < 0) {
            // Zoom in
            setIsZoomed(true);
        } else {
            // Zoom out
            setIsZoomed(false);
            setPosition({ x: 50, y: 50 });
        }
    };

    return (
        <div
            ref={containerRef}
            className={`magnifier-container ${containerClass}`}
            onMouseMove={isZoomed ? handleMouseMovePan : handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            role="img"
            aria-label={alt}
        >
            <img
                src={src}
                alt={alt}
                className={`magnifier-image ${isZoomed ? 'zoomed' : ''}`}
                style={{
                    transformOrigin: isZoomed ? `${position.x}% ${position.y}%` : 'center center',
                    transform: isZoomed ? `scale(${zoomLevel})` : 'scale(1)',
                    cursor: isZoomed ? 'grab' : 'zoom-in'
                }}
                draggable={false}
            />

            {/* Magnifier Lens indicator */}
            {showMagnifier && zoomLevel > 1 && (
                <div className="magnifier-controls">
                    <button
                        className="magnifier-toggle"
                        onClick={toggleZoom}
                        title={isZoomed ? 'Thu nhỏ' : 'Phóng to'}
                    >
                        {isZoomed ? '🔍' : '🔍'}
                    </button>
                    {isZoomed && (
                        <span className="magnifier-hint">
                            Kéo để di chuyển • Cuộn để thu nhỏ
                        </span>
                    )}
                </div>
            )}

            {/* Zoom indicator */}
            {isZoomed && (
                <div className="zoom-indicator">
                    <span>🔍 {zoomLevel}x</span>
                </div>
            )}
        </div>
    );
};

// Result Display Component with Magnifier
interface ResultDisplayProps {
    src: string | null;
    alt: string;
    isLoading?: boolean;
    loadingText?: string;
    placeholder?: boolean;
}

const ResultDisplay = ({
    src,
    alt,
    isLoading = false,
    loadingText = 'Đang xử lý...',
    placeholder = false
}: ResultDisplayProps) => {
    const [showMagnifier, setShowMagnifier] = useState(true);

    if (placeholder) {
        return (
            <div className="result-placeholder">
                <div className="placeholder-text">
                    <span className="placeholder-icon">🖼️</span>
                    <p>Chưa có kết quả</p>
                </div>
            </div>
        );
    }

    return (
        <div className="result-display">
            {isLoading ? (
                <div className="loader-container">
                    <div className="spinner"></div>
                    <p>{loadingText}</p>
                </div>
            ) : src ? (
                <MagnifierImage
                    src={src}
                    alt={alt}
                    zoomLevel={2}
                    showMagnifier={showMagnifier}
                    containerClass="result-magnifier"
                />
            ) : (
                <div className="placeholder-text">
                    <span className="placeholder-icon">🖼️</span>
                    <p>Chưa có kết quả</p>
                </div>
            )}
        </div>
    );
};

// Before/After Slider Component with Clipping Technique
interface BeforeAfterSliderProps {
    beforeSrc: string | null;
    afterSrc: string | null;
    beforeAlt?: string;
    afterAlt?: string;
    isLoading?: boolean;
    loadingText?: string;
}

const BeforeAfterSlider = ({
    beforeSrc,
    afterSrc,
    beforeAlt = 'Before',
    afterAlt = 'After',
    isLoading = false,
    loadingText = 'Đang xử lý...'
}: BeforeAfterSliderProps) => {
    const [position, setPosition] = useState(50);

    if (isLoading) {
        return (
            <div className="before-after-slider">
                <div className="loader-container">
                    <div className="spinner"></div>
                    <p>{loadingText}</p>
                </div>
            </div>
        );
    }

    if (!beforeSrc && !afterSrc) {
        return (
            <div className="result-placeholder">
                <div className="placeholder-text">
                    <span className="placeholder-icon">🖼️</span>
                    <p>Chưa có kết quả</p>
                </div>
            </div>
        );
    }

    if (!beforeSrc || !afterSrc) {
        const singleSrc = beforeSrc || afterSrc;
        const singleAlt = beforeSrc ? beforeAlt : afterAlt;
        return (
            <div className="before-after-slider single">
                {singleSrc && <img className="before-after-img" src={singleSrc} alt={singleAlt} />}
                {beforeSrc && <div className="before-after-label before">Trước</div>}
                {afterSrc && <div className="before-after-label after">Sau</div>}
                {!afterSrc && beforeSrc && <div className="before-after-empty">Chưa có kết quả</div>}
            </div>
        );
    }

    return (
        <div className="before-after-slider" style={{ ['--ba-pos' as any]: `${position}%` }}>
            <div className="before-after-inner">
                {/* After image - bottom layer, full width */}
                <img
                    className="before-after-img after"
                    src={afterSrc}
                    alt={afterAlt}
                />
                {/* Before image - top layer, clipped */}
                <div className="before-after-before">
                    <img
                        className="before-after-img before"
                        src={beforeSrc}
                        alt={beforeAlt}
                    />
                </div>
            </div>
            {/* Handle */}
            <div
                className="before-after-handle"
                style={{ left: `${position}%` }}
            >
                <div className="handle-line"></div>
                <div className="handle-circle">
                    <span className="handle-arrows">◀ ▶</span>
                </div>
                <div className="handle-line"></div>
            </div>
            {/* Invisible range input for interaction */}
            <input
                className="before-after-range"
                type="range"
                min="0"
                max="100"
                value={position}
                onChange={(e) => setPosition(Number(e.target.value))}
                aria-label="Before and after slider"
            />
            {/* Labels */}
            <div className="before-after-label before">Trước</div>
            <div className="before-after-label after">Sau</div>
        </div>
    );
};

const App = () => {
    // --- API Settings State ---
    const [apiSettings, setApiSettings] = useState<ApiSettings>(() => {
        // Load from local storage or use default
        const saved = localStorage.getItem('ai_studio_settings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                
                // MIGRATION LOGIC: Check if keys are strings (legacy format) and convert to array
                const isLegacy = typeof parsed.keys?.gemini === 'string' || typeof parsed.keys?.openai === 'string';
                
                if (isLegacy) {
                    return {
                        ...DEFAULT_SETTINGS,
                        provider: parsed.provider || 'gemini',
                        keys: {
                            gemini: parsed.keys.gemini ? [{ id: 'legacy-gemini', key: parsed.keys.gemini, label: 'Default Key', isActive: true, createdAt: Date.now() }] : [],
                            grok: parsed.keys.grok ? [{ id: 'legacy-grok', key: parsed.keys.grok, label: 'Default Key', isActive: true, createdAt: Date.now() }] : []
                        },
                        models: parsed.models || DEFAULT_SETTINGS.models
                    };
                }
                
                return parsed;
            } catch (e) {
                return DEFAULT_SETTINGS;
            }
        }
        return DEFAULT_SETTINGS;
    });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isGuideOpen, setIsGuideOpen] = useState(false);

    // Tab State
    const [activeTab, setActiveTab] = useState<'try-on' | 'skin-fix' | 'breast-aug' | 'swap-face' | 'ai-influencer' | 'change-background'>('try-on');

    // --- Try-On States (Mix & Match Mode) ---
    // Clothing items (optional uploads)
    const [topImage, setTopImage] = useState<string | null>(null);
    const [bottomImage, setBottomImage] = useState<string | null>(null); // Pants/Quần
    const [skirtImage, setSkirtImage] = useState<string | null>(null);   // Váy/Đầm
    const [shoesImage, setShoesImage] = useState<string | null>(null);
    const [jewelryImage, setJewelryImage] = useState<string | null>(null);  // Trang sức
    const [bagImage, setBagImage] = useState<string | null>(null);          // Túi xách

    // Reference images for fullset (up to 3 images for different angles/reference)
    const [refImages, setRefImages] = useState<(string | null)[]>([null, null, null]);

    // Accessories section collapsed/expanded state
    const [isAccessoriesExpanded, setIsAccessoriesExpanded] = useState(false);

    // --- AI Clothing Generator States ---
    const [selectedAIClothing, setSelectedAIClothing] = useState<string | null>(null);
    const [isGeneratingClothing, setIsGeneratingClothing] = useState(false);
    const [aiGeneratedClothing, setAiGeneratedClothing] = useState<string | null>(null);

    // Danh sách 30 loại trang phục AI có thể generate
    const aiClothingOptions = [
        { id: 'sexy-bikini-1', name: 'Bikini Gợi Cảm 🔥', category: ' swimwear', description: 'Bikini hai mảnh gợi cảm' },
        { id: 'sexy-bikini-2', name: 'Bikini Viền 🌴', category: 'swimwear', description: 'Bikini viền hoa văn' },
        { id: 'sexy-bikini-3', name: 'Monokini 💎', category: 'swimwear', description: 'Monokini một mảnh sexy' },
        { id: 'sexy-dress-1', name: 'Đầm Ôm Sexy 💃', category: 'dress', description: 'Đầm ôm sát, gợi cảm' },
        { id: 'sexy-dress-2', name: 'Đầm Xẻ Đùi 🌹', category: 'dress', description: 'Đầm dạ hội xẻ đùi' },
        { id: 'sexy-dress-3', name: 'Đầm Lưới 🔥', category: 'dress', description: 'Đầm ren/lưới sexy' },
        { id: 'sexy-top-1', name: 'Crop Top Ngắn 👚', category: 'top', description: 'Crop top ôm ngắn' },
        { id: 'sexy-top-2', name: 'Bra Top 🔥', category: 'top', description: 'Bra top gợi cảm' },
        { id: 'sexy-top-3', name: 'Corset Bustier 👗', category: 'top', description: 'Corset nịt ngực' },
        { id: 'sexy-bottom-1', name: 'Quần Lót Cao 👙', category: 'bottom', description: 'Quần lót waist' },
        { id: 'sexy-bottom-2', name: 'Quần Short Ngắn 🩳', category: 'bottom', description: 'Short mini sexy' },
        { id: 'sexy-bottom-3', name: 'Skirt Mini 🎀', category: 'bottom', description: 'Váy mini ngắn' },
        { id: 'lingerie-1', name: 'Lingerie Gợi Cảm 💋', category: 'lingerie', description: 'Bộ lingerie đầy đủ' },
        { id: 'lingerie-2', name: 'Babydoll 🌸', category: 'lingerie', description: 'Babydoll mỏng nhẹ' },
        { id: 'lingerie-3', name: 'Teddy Bodysuit 🔥', category: 'lingerie', description: 'Teddy bodysuit' },
        { id: 'evening-gown-1', name: 'Váy Dạ Hội 👑', category: 'dress', description: 'Váy dạ hội sang trọng' },
        { id: 'evening-gown-2', name: 'Váy Prom 🎓', category: 'dress', description: 'Váy prom thanh lịch' },
        { id: 'evening-gown-3', name: 'Váy Gala 💎', category: 'dress', description: 'Váy gala cao cấp' },
        { id: 'casual-1', name: 'Áo Thun + Quần 👕', category: 'casual', description: 'Bộ đồ thường ngày' },
        { id: 'casual-2', name: 'Áo Sơ Mi + Váy 👚', category: 'casual', description: 'Bộ casual nữ tính' },
        { id: 'casual-3', name: 'Hoodie + Quần Rộng 🧥', category: 'casual', description: 'Streetwear thoải mái' },
        { id: 'formal-1', name: 'Vest Công Sở 👔', category: 'formal', description: 'Bộ vest professional' },
        { id: 'formal-2', name: 'Đầm Công Sở 💼', category: 'formal', description: 'Đầm office thanh lịch' },
        { id: 'formal-3', name: 'Blazer + Chân Váy 👗', category: 'formal', description: 'Set blazer chic' },
        { id: 'sport-1', name: 'Đồ Thể Thao 🏃', category: 'sport', description: 'Bộ sport năng động' },
        { id: 'sport-2', name: 'Yoga Outfit 🧘', category: 'sport', description: 'Đồ yoga ôm sát' },
        { id: 'sport-3', name: 'Bikini Thể Thao 🏊', category: 'swimwear', description: 'Sport bikini' },
        { id: 'winter-1', name: 'Áo Len Dày 🧶', category: 'winter', description: 'Áo len ấm áp' },
        { id: 'winter-2', name: 'Áo Khoác Lông 🦊', category: 'winter', description: 'Lông cừu sang trọng' },
    ];

    // --- Face Swap States ---
    const [faceSourceFile, setFaceSourceFile] = useState<File | null>(null);
    const [faceSourcePreview, setFaceSourcePreview] = useState<string | null>(null);
    const [swapResult, setSwapResult] = useState<string | null>(null);
    const [isSwapping, setIsSwapping] = useState(false);
    const [isHotSwap, setIsHotSwap] = useState(false); // Swap main and face source

    // --- AI Influencer States ---
    const [influencerResult, setInfluencerResult] = useState<string | null>(null);
    const [isGeneratingInfluencer, setIsGeneratingInfluencer] = useState(false);

    // --- Change Background States ---
    const [bgSourceFile, setBgSourceFile] = useState<File | null>(null);
    const [bgSourcePreview, setBgSourcePreview] = useState<string | null>(null);
    const [customBgFile, setCustomBgFile] = useState<File | null>(null);
    const [customBgPreview, setCustomBgPreview] = useState<string | null>(null);
    const [bgResult, setBgResult] = useState<string | null>(null);
    const [isChangingBg, setIsChangingBg] = useState(false);
    const [selectedBackground, setSelectedBackground] = useState<string | null>(null);
    const [showBgSelector, setShowBgSelector] = useState(false);

    // 54 Background Presets (Transparent handled separately in UI)
    const backgroundPresets = [
        // Original 20
        { id: 'fashion-store', name: 'Cửa hàng thời trang', icon: '🏪', desc: 'Store' },
        { id: 'beach', name: 'Bãi biển', icon: '🏖️', desc: 'Beach' },
        { id: 'cafe', name: 'Quán cà phê', icon: '☕', desc: 'Cafe' },
        { id: 'garden', name: 'Vườn hoa', icon: '🌸', desc: 'Garden' },
        { id: 'studio', name: 'Photo Studio', icon: '📸', desc: 'Studio' },
        { id: 'street', name: 'Phố đi bộ', icon: '🏙️', desc: 'Street' },
        { id: 'park', name: 'Công viên', icon: '🌳', desc: 'Park' },
        { id: 'restaurant', name: 'Nhà hàng', icon: '🍽️', desc: 'Restaurant' },
        { id: 'hotel-lobby', name: 'Khách sạn', icon: '🏨', desc: 'Hotel' },
        { id: 'boutique', name: 'Shop quần áo', icon: '👗', desc: 'Boutique' },
        { id: 'rooftop', name: 'Sân thượng', icon: '🌆', desc: 'Rooftop' },
        { id: 'mall', name: 'TT Thương mại', icon: '🛍️', desc: 'Mall' },
        { id: 'nature', name: 'Thiên nhiên', icon: '🌿', desc: 'Nature' },
        { id: 'urban', name: 'Đô thị', icon: '🏗️', desc: 'Urban' },
        { id: 'sunset', name: 'Hoàng hôn', icon: '🌅', desc: 'Sunset' },
        { id: 'office', name: 'Văn phòng', icon: '💼', desc: 'Office' },
        { id: 'gym', name: 'Phòng gym', icon: '🏋️', desc: 'Gym' },
        { id: 'photobooth', name: 'Photo Booth', icon: '🎪', desc: 'Booth' },
        { id: 'neon', name: 'Neon City', icon: '🌃', desc: 'Neon' },
        { id: 'vintage', name: 'Phong cách cổ', icon: '🎨', desc: 'Vintage' },
        // Additional 25
        { id: 'bedroom', name: 'Phòng ngủ', icon: '🛏️', desc: 'Bedroom' },
        { id: 'kitchen', name: 'Nhà bếp', icon: '🍳', desc: 'Kitchen' },
        { id: 'balcony', name: 'Ban công', icon: '🌺', desc: 'Balcony' },
        { id: '游泳池', name: 'Hồ bơi', icon: '🏊', desc: 'Pool' },
        { id: 'yoga', name: 'Phòng yoga', icon: '🧘', desc: 'Yoga' },
        { id: 'library', name: 'Thư viện', icon: '📚', desc: 'Library' },
        { id: 'museum', name: 'Bảo tàng', icon: '🏛️', desc: 'Museum' },
        { id: 'cinema', name: 'Rạp chiếu phim', icon: '🎬', desc: 'Cinema' },
        { id: 'bar', name: 'Quán bar', icon: '🍸', desc: 'Bar' },
        { id: 'garden-wedding', name: 'Vườn cưới', icon: '💒', desc: 'Wedding' },
        { id: 'island', name: 'Đảo nhiệt đới', icon: '🏝️', desc: 'Island' },
        { id: 'waterfall', name: 'Thác nước', icon: '💦', desc: 'Waterfall' },
        { id: 'mountain', name: 'Núi non', icon: '🏔️', desc: 'Mountain' },
        { id: 'snow', name: 'Tuyết rơi', icon: '❄️', desc: 'Snow' },
        { id: 'desert', name: 'Sa mạc', icon: '🏜️', desc: 'Desert' },
        { id: 'lavender', name: 'Cánh lavender', icon: '🟣', desc: 'Lavender' },
        { id: 'cherry-blossom', name: 'Hoa anh đào', icon: '🌸', desc: 'Sakura' },
        { id: 'autumn', name: 'Mùa thu', icon: '🍂', desc: 'Autumn' },
        { id: 'castle', name: 'Lâu đài', icon: '🏰', desc: 'Castle' },
        { id: 'villa', name: 'Biệt thự', icon: '🏡', desc: 'Villa' },
        { id: 'cruise', name: 'Du thuyền', icon: '🚢', desc: 'Cruise' },
        { id: 'airplane', name: 'Máy bay', icon: '✈️', desc: 'Airplane' },
        { id: 'train', name: 'Tàu hỏa', icon: '🚂', desc: 'Train' },
        { id: 'skyscraper', name: 'Tòa nhà cao', icon: '🏢', desc: 'Tower' },
        { id: 'farm', name: 'Nông trại', icon: '🌾', desc: 'Farm' },
        { id: 'greenhouse', name: 'Nhà kính', icon: '🏠', desc: 'Greenhouse' },
    ];

    // Influencer attributes
    const [influencerGender, setInfluencerGender] = useState<string>('Female');
    const [influencerAge, setInfluencerAge] = useState<string>('20s');
    const [influencerEthnicity, setInfluencerEthnicity] = useState<string>('Việt Nam - Miền Bắc');
    const [influencerSkinTone, setInfluencerSkinTone] = useState<string>('Medium (Nude)');

    // Hair attributes
    const [influencerHairLength, setInfluencerHairLength] = useState<string>('Long');
    const [influencerHairColor, setInfluencerHairColor] = useState<string>('Natural black');
    const [influencerHairTexture, setInfluencerHairTexture] = useState<string>('Straight silky');
    const [influencerHairBangs, setInfluencerHairBangs] = useState<string>('No bangs');
    const [influencerEyeColor, setInfluencerEyeColor] = useState<string>('Brown');

    // Body & Style
    const [influencerBody, setInfluencerBody] = useState<string>('Balanced');
    const [influencerStyle, setInfluencerStyle] = useState<string>('Modern luxury');
    const [influencerScenario, setInfluencerScenario] = useState<string>('Cozy cafe, morning sunlight');
    const [influencerAspectRatio, setInfluencerAspectRatio] = useState<'9:16' | '16:9'>('9:16');
    const [influencerRefFile, setInfluencerRefFile] = useState<File | null>(null);
    const [influencerRefPreview, setInfluencerRefPreview] = useState<string | null>(null);
    const [influencerRefOptions, setInfluencerRefOptions] = useState({
        style: false,
        face: false,
        body: false,
        outfit: false
    });
    const [influencerPrompt, setInfluencerPrompt] = useState<string>('');
    const influencerPromptAutoRef = useRef<string>('');

    // Generation Settings
    const [generationSettings, setGenerationSettings] = useState({
        changePose: false,      // Thay đổi tư thế
        changeBackground: false, // Đổi bối cảnh
        transparentBackground: false, // Nền trong suốt
        generateFullBody: false, // Tạo ảnh toàn thân
        changeExpression: false, // Thay đổi biểu cảm
        aspectRatio: '9:16' as '9:16' | '16:9' // Aspect Ratio
    });

    // Common Try-On States
    const [modelFile, setModelFile] = useState<File | null>(null);
    const [modelPreview, setModelPreview] = useState<string | null>(null);
    const [finalImage, setFinalImage] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // --- Skin Fix States ---
    const [skinFile, setSkinFile] = useState<File | null>(null);
    const [skinPreview, setSkinPreview] = useState<string | null>(null);
    const [skinResult, setSkinResult] = useState<string | null>(null);
    const [isFixingSkin, setIsFixingSkin] = useState(false);
    const [autoFixFromUrl, setAutoFixFromUrl] = useState<string | null>(null); // For auto-fix from try-on result

    // --- Breast Augmentation States ---
    const [breastAugFile, setBreastAugFile] = useState<File | null>(null);
    const [breastAugPreview, setBreastAugPreview] = useState<string | null>(null);
    const [breastAugResult, setBreastAugResult] = useState<string | null>(null);
    const [isBreastAugmenting, setIsBreastAugmenting] = useState(false);
    const [autoAugFromUrl, setAutoAugFromUrl] = useState<string | null>(null); // For auto-aug from skin-fix result

    // --- Common States ---
    const [error, setError] = useState<string | null>(null);

    // Helper to get the Active API Key String
    const getActiveKey = (provider: Provider): string | null => {
        const keys = apiSettings.keys[provider];
        const activeKeyEntry = keys.find(k => k.isActive);
        return activeKeyEntry ? activeKeyEntry.key : null;
    };

    // Handle Settings Save
    const handleSaveSettings = (newSettings: ApiSettings) => {
        setApiSettings(newSettings);
        localStorage.setItem('ai_studio_settings', JSON.stringify(newSettings));
        setIsSettingsOpen(false);
        setError(null); // Clear errors
    };

    // Helper to check provider validity
    const checkProviderReady = () => {
        const activeKey = getActiveKey(apiSettings.provider);
        if (!activeKey) {
            setError(`Vui lòng thêm và kích hoạt API Key cho ${apiSettings.provider.toUpperCase()} trong phần Cài đặt.`);
            setIsSettingsOpen(true);
            return false;
        }
        return true;
    };

    const handleTabChange = (tab: 'try-on' | 'skin-fix' | 'breast-aug' | 'swap-face' | 'ai-influencer' | 'change-background') => {
        setActiveTab(tab);
        setError(null);
        setIsDownloadMenuOpen(false);
    };

    // Convert data URL to File and trigger auto-fix skin
    const handleAutoFixSkin = (imageUrl: string) => {
        // Clear previous skin results
        setSkinResult(null);

        // Set auto-fix URL and switch to skin-fix tab
        setAutoFixFromUrl(imageUrl);
        setActiveTab('skin-fix');

        // Clear any errors
        setError(null);
        setIsDownloadMenuOpen(false);
    };

    // Helper: Convert data URL to File (without using fetch)
    const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File | null> => {
        try {
            console.log('Converting data URL to file:', filename);

            // Extract the base64 data from data URL
            const res = dataUrl.match(/,(.+)$/);
            if (!res) {
                console.error('Invalid data URL format');
                return null;
            }

            const mimeType = dataUrl.match(/^data:(.+);/)?.[1] || 'image/png';
            const base64Data = res[1];

            // Validate base64 data
            if (!base64Data || base64Data.length === 0) {
                console.error('Empty base64 data');
                return null;
            }

            // Convert base64 to blob
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const blob = new Blob([bytes], { type: mimeType });
            console.log('Created blob:', mimeType, 'size:', blob.size);

            const file = new File([blob], filename, { type: mimeType });
            console.log('Created file:', file.name, 'size:', file.size, 'type:', file.type);

            return file;
        } catch (err) {
            console.error('Error converting data URL to file:', err);
            return null;
        }
    };

    // Effect to handle auto-fix when skin-fix tab is active and autoFixFromUrl is set
    useEffect(() => {
        if (activeTab === 'skin-fix' && autoFixFromUrl) {
            console.log('Auto-fix triggered with URL:', autoFixFromUrl.substring(0, 50) + '...');
            const processAutoFix = async () => {
                try {
                    const file = await dataUrlToFile(autoFixFromUrl, 'auto-fix-image.png');
                    console.log('Converted file:', file ? { name: file.name, size: file.size, type: file.type } : null);
                    if (file) {
                        // Update state first
                        setSkinFile(file);
                        setSkinPreview(autoFixFromUrl);

                        // Clear autoFixFromUrl AFTER setting state to avoid re-triggering
                        // Use a timeout to ensure state is updated before clearing
                        setTimeout(() => {
                            setAutoFixFromUrl(null);
                        }, 50);

                        // Auto-trigger skin fix AFTER setting state
                        setTimeout(() => {
                            console.log('Calling handleFixSkin with file');
                            handleFixSkin(file);
                        }, 100);
                    } else {
                        setError('Không thể xử lý ảnh tự động. Vui lòng thử lại.');
                        setAutoFixFromUrl(null);
                    }
                } catch (err) {
                    console.error('Auto-fix error:', err);
                    setError('Không thể xử lý ảnh tự động. Vui lòng thử lại.');
                    setAutoFixFromUrl(null);
                }
            };

            processAutoFix();
        }
    }, [activeTab, autoFixFromUrl]);

    // Convert data URL to File and trigger auto breast augmentation
    const handleAutoBreastAug = (imageUrl: string) => {
        // Clear previous breast aug results
        setBreastAugResult(null);

        // Set auto-aug URL and switch to breast-aug tab
        setAutoAugFromUrl(imageUrl);
        setActiveTab('breast-aug');

        // Clear any errors
        setError(null);
        setIsDownloadMenuOpen(false);
    };

    // Effect to handle auto-aug when breast-aug tab is active and autoAugFromUrl is set
    useEffect(() => {
        if (activeTab === 'breast-aug' && autoAugFromUrl) {
            console.log('Auto-breast-aug triggered with URL:', autoAugFromUrl.substring(0, 50) + '...');
            const processAutoAug = async () => {
                try {
                    const file = await dataUrlToFile(autoAugFromUrl, 'auto-aug-image.png');
                    console.log('Converted file:', file ? { name: file.name, size: file.size, type: file.type } : null);
                    if (file) {
                        // Update state first
                        setBreastAugFile(file);
                        setBreastAugPreview(autoAugFromUrl);

                        // Clear autoAugFromUrl AFTER setting state to avoid re-triggering
                        // Use a timeout to ensure state is updated before clearing
                        setTimeout(() => {
                            setAutoAugFromUrl(null);
                        }, 50);

                        // Auto-trigger breast aug AFTER setting state
                        setTimeout(() => {
                            console.log('Calling handleBreastAugmentation with file');
                            handleBreastAugmentation(file);
                        }, 100);
                    } else {
                        setError('Không thể tự động nâng ngực. Vui lòng thử lại.');
                        setAutoAugFromUrl(null);
                    }
                } catch (err) {
                    console.error('Auto-aug error:', err);
                    setError('Không thể tự động nâng ngực. Vui lòng thử lại.');
                    setAutoAugFromUrl(null);
                }
            };

            processAutoAug();
        }
    }, [activeTab, autoAugFromUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setFile: (file: File | null) => void, setPreview: (url: string | null) => void) => {
        const file = e.target.files?.[0];
        if (file) {
            setFile(file);
            setPreview(URL.createObjectURL(file));
            setError(null);
        }
    };

    const handleDirectGarmentUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'top' | 'bottom' | 'skirt' | 'shoes' | 'jewelry' | 'bag') => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            if (type === 'top') setTopImage(url);
            else if (type === 'bottom') setBottomImage(url);
            else if (type === 'skirt') setSkirtImage(url);
            else if (type === 'shoes') setShoesImage(url);
            else if (type === 'jewelry') setJewelryImage(url);
            else if (type === 'bag') setBagImage(url);
            setError(null);
        }
    };

    const handleRemoveGarment = (type: 'top' | 'bottom' | 'skirt' | 'shoes' | 'jewelry' | 'bag') => {
        if (type === 'top') setTopImage(null);
        else if (type === 'bottom') setBottomImage(null);
        else if (type === 'skirt') {
            setSkirtImage(null);
            setRefImages([null, null, null]); // Also clear reference images
        }
        else if (type === 'shoes') setShoesImage(null);
        else if (type === 'jewelry') setJewelryImage(null);
        else if (type === 'bag') setBagImage(null);
    };

    // Handle reference image upload (for fullset reference)
    const handleRefImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setRefImages(prev => {
                const newRefs = [...prev];
                newRefs[index] = url;
                return newRefs;
            });
            setError(null);
        }
    };

    // Handle remove reference image
    const handleRemoveRefImage = (index: number) => {
        setRefImages(prev => {
            const newRefs = [...prev];
            newRefs[index] = null;
            return newRefs;
        });
    };

    const toggleGenerationSetting = (option: keyof typeof generationSettings) => {
        if (option === 'aspectRatio') return; // Handled separately
        setGenerationSettings(prev => ({
            ...prev,
            [option]: !prev[option as keyof typeof prev]
        }));
    };

    const setAspectRatio = (ratio: '9:16' | '16:9') => {
        setGenerationSettings(prev => ({ ...prev, aspectRatio: ratio }));
    };

    const toggleInfluencerRefOption = (option: keyof typeof influencerRefOptions) => {
        setInfluencerRefOptions(prev => ({
            ...prev,
            [option]: !prev[option]
        }));
    };

    const handleInfluencerRefChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setInfluencerRefFile(file);
            setInfluencerRefPreview(URL.createObjectURL(file));
            setError(null);
        }
    };

    const handleRemoveInfluencerRef = () => {
        setInfluencerRefFile(null);
        setInfluencerRefPreview(null);
    };

    const buildInfluencerRefInstructions = () => {
        const refOptionLabels: string[] = [];
        if (influencerRefOptions.style) refOptionLabels.push('STYLE / AESTHETIC (colors, mood, lighting)');
        if (influencerRefOptions.face) refOptionLabels.push('FACIAL FEATURES (shape, eyes, nose, lips) - do not copy identity');
        if (influencerRefOptions.body) refOptionLabels.push('BODY TYPE / PROPORTIONS');
        if (influencerRefOptions.outfit) refOptionLabels.push('OUTFIT / CLOTHING DETAILS');
        const refOptionText = refOptionLabels.length
            ? refOptionLabels.join(' | ')
            : 'overall visual vibe only (colors, mood, lighting)';
        const refDetailLines: string[] = [];
        if (influencerRefOptions.style) {
            refDetailLines.push('- STYLE: match color palette, lighting, mood, and overall aesthetic');
        }
        if (influencerRefOptions.face) {
            refDetailLines.push('- FACE: follow facial structure and proportions; keep identity original');
        }
        if (influencerRefOptions.body) {
            refDetailLines.push('- BODY: follow silhouette/proportions while respecting the selected body type');
        }
        if (influencerRefOptions.outfit) {
            refDetailLines.push('- OUTFIT: adapt clothing shapes, layers, and accessories to the chosen style & scenario');
        }
        const refDetailText = refDetailLines.length
            ? refDetailLines.join('\n')
            : '- Use the reference only as a loose overall vibe (colors, lighting, mood).';
        return influencerRefFile
            ? `REFERENCE IMAGE PROVIDED (IMAGE 1):
- Use the reference image ONLY for: ${refOptionText}
${refDetailText}
- If it conflicts with the selected attributes, prioritize the selected attributes
- Keep the person original; do NOT copy the exact identity`
            : 'NO REFERENCE IMAGE PROVIDED.';
    };

    const buildInfluencerPrompt = (refInstructions: string) => `Create a photorealistic AI influencer character with the following specifications:

GENDER: ${influencerGender}
AGE RANGE: ${influencerAge}
NATIONALITY/REGION: Vietnamese — ${influencerEthnicity}
SKIN TONE: ${influencerSkinTone}

HAIR CHARACTERISTICS:
- Length: ${influencerHairLength}
- Color: ${influencerHairColor}
- Texture: ${influencerHairTexture}
- Bangs style: ${influencerHairBangs}

EYE COLOR: ${influencerEyeColor}
BODY TYPE: ${influencerBody}

FASHION STYLE: ${influencerStyle}

SCENARIO/CONTEXT: ${influencerScenario}

${refInstructions}

REQUIREMENTS:
1. Create a highly detailed, photorealistic human character
2. Natural skin texture with realistic pores and texture (no plastic skin)
3. Natural hair strands and realistic hair movement
4. Consistent lighting and shadows
5. Professional fashion photography quality
6. Expressive face with natural proportions
7. If background is requested, make it clean and professional
8. Age-appropriate appearance matching the specified age range
9. Vietnamese identity with respectful, realistic aesthetics
10. Use regional styling cues (fashion, mood, setting) that reflect the selected Vietnamese region without caricature

OUTPUT ASPECT RATIO: ${influencerAspectRatio}
OUTPUT: A single, high-quality portrait photograph of the AI influencer character.`;

    useEffect(() => {
        const nextAuto = buildInfluencerPrompt(buildInfluencerRefInstructions());
        const shouldAutoUpdate = influencerPrompt.trim() === '' || influencerPrompt === influencerPromptAutoRef.current;
        if (shouldAutoUpdate && influencerPrompt !== nextAuto) {
            setInfluencerPrompt(nextAuto);
        }
        influencerPromptAutoRef.current = nextAuto;
    }, [
        influencerGender,
        influencerAge,
        influencerEthnicity,
        influencerSkinTone,
        influencerHairLength,
        influencerHairColor,
        influencerHairTexture,
        influencerHairBangs,
        influencerEyeColor,
        influencerBody,
        influencerStyle,
        influencerScenario,
        influencerAspectRatio,
        influencerRefFile,
        influencerRefOptions,
        influencerPrompt
    ]);

    const handleGenerateTryOn = async () => {
        if (!checkProviderReady()) return;

        if (!modelFile) {
            setError('Vui lòng tải ảnh người mẫu.');
            return;
        }

        // Check if at least one item is selected
        const hasAnyItem = topImage || bottomImage || skirtImage || shoesImage || jewelryImage || bagImage;
        if (!hasAnyItem) {
            setError('Vui lòng chọn ít nhất một món đồ (áo, quần/váy, giày, trang sức hoặc túi) để thay.');
            return;
        }

        // Check if Fullset is the ONLY source (no separate items)
        // This means user wants to extract EVERYTHING from the fullset image
        const isFullsetOnlyMode = skirtImage && !topImage && !bottomImage && !shoesImage;

        setIsGenerating(true);
        setError(null);
        setFinalImage(null);

        try {
            // Use configured provider
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });

            const parts: any[] = [];
            let instructions = "You are a professional fashion editor and creative director. ";

            // --- Common Instructions for Pose, Background, and Full Body ---
            const poseInstruction = generationSettings.changePose
                ? "POSE ADAPTATION: The model's pose MUST be changed. Generate a new, natural, and dynamic fashion pose that best showcases the new outfit. Do not be constrained by the original pose."
                : "POSE PRESERVATION: Keep the model's body pose, head position, and gesture identical to the original image (unless Full Body Generation requires extending the pose).";

            let backgroundInstruction: string;
            if (generationSettings.transparentBackground) {
                backgroundInstruction = "TRANSPARENT BACKGROUND: Remove the background completely. The model should appear on a transparent (alpha channel) background. Keep ONLY the model with the outfit - no background, no scenery, nothing else. The output must be a clean cutout of the model.";
            } else if (generationSettings.changeBackground) {
                backgroundInstruction = "BACKGROUND GENERATION: Replace the original background completely. Generate a new, high-quality, realistic setting that matches the style of the outfit. The lighting on the model must match this new background.";
            } else {
                backgroundInstruction = "BACKGROUND PRESERVATION: Keep the original background EXACTLY as it is. Do not change the scene (unless Full Body Generation requires extending the background).";
            }

            const fullBodyInstruction = generationSettings.generateFullBody
                ? "FULL BODY GENERATION: The input model image might be half-body or cropped. You MUST generate a FULL BODY output. Extrapolate legs, feet, and missing limbs naturally. Ensure the outfit (especially pants/shoes) is fully visible. Resize/outpaint as necessary to fit the full body."
                : "FRAME PRESERVATION: Keep the original framing/crop of the model image.";
            // ---------------------------------------------------

            if (isFullsetOnlyMode) {
                // === FULLSET MODE: Extract EVERYTHING from the single image ===
                const fullsetPart = await urlToGenerativePart(skirtImage);
                parts.push(fullsetPart);

                // Add reference images if any exist
                const validRefImages = refImages.filter(img => img !== null);
                for (const refImage of validRefImages) {
                    const refPart = await urlToGenerativePart(refImage);
                    parts.push(refPart);
                }

                const modelPart = await fileToGenerativePart(modelFile);
                parts.push(modelPart);

                const refCount = validRefImages.length;
                const refImagesNote = refCount > 0
                    ? `\n\nREFERENCE IMAGES (${refCount} images):
The user provided ${refCount} additional reference image(s) showing the same outfit from different angles or different models.
- These reference images are ONLY for COMPARISON and REFERENCE purposes
- Use them to better understand the outfit details, patterns, and design
- The PRIMARY source for extraction is ALWAYS the FIRST image (main fullset)
- If reference images show different angles, use them to complete missing details
- DO NOT copy the body/person from reference images - only extract the clothing items`
                    : '';

                const refImagesOrderNote = refCount > 0
                    ? `- IMAGES 2-${refCount + 1}: Reference images (for comparison only)
- IMAGE ${refCount + 2}: Target Model (the person who will wear all items)`
                    : `- IMAGE 2: Target Model (the person who will wear all items)`;

                instructions += `MODE: FULLSET EXTRACTION & TRANSFER${refImagesNote}

CRITICAL - IMAGE ORDER:
- IMAGE 1 (PRIMARY): Fullset Outfit - contains ALL clothing items to extract${refImagesOrderNote}

MISSION: Take ALL clothing items from the FIRST image (fullset) and TRANSFER them onto the MODEL in the LAST image.

PRIMARY RULE: The output must be based EXCLUSIVELY on IMAGE 1 (main fullset).
Reference images are only hints - not the source of clothing items.

CRITICAL INSTRUCTIONS:
1. START WITH THE MODEL: The output must show the PERSON from the LAST image (model)
2. EXTRACT clothing items from IMAGE 1 (the main fullset) - THIS IS YOUR PRIMARY SOURCE
3. Use reference images (if any) only to understand outfit details from different angles
4. TRANSFER all extracted items onto the model
5. The model in the output must look like the model in the LAST input image!

6. INTELLIGENT ITEM DETECTION: Analyze the fullset image and identify ALL clothing items present:
   - TOPS: shirts, blouses, jackets, tops, sweaters, coats, dresses (upper part)
   - BOTTOMS: pants, trousers, jeans, shorts, skirts, skirtsuits (lower part)
   - FOOTWEAR: shoes, sneakers, sandals, boots, heels, slippers
   - ACCESSORIES: jewelry, necklaces, earrings, bracelets, rings, glasses, watches, belts, bags, scarves
   - HEADWEAR: hats, caps, headbands, hair accessories

7. COMPLETE TRANSFER: Transfer EVERY single item found in the fullset image to the model.
   - If it's a dress/jumpsuit: apply the entire garment
   - If it's a separates set (top + bottom): apply both items
   - Apply ALL accessories, footwear, and jewelry shown

8. PRESERVATION: Remove the model's original clothing ENTIRELY before applying new items.
   - PRESERVE the model's face, hair, skin tone, and body shape EXACTLY

9. NATURAL COMPOSITING: Fit all items naturally on the model. Match lighting, shadows, and proportions.

10. ${poseInstruction}

11. ${backgroundInstruction}

12. ${fullBodyInstruction}

OUTPUT: A photorealistic image of THE MODEL (from the LAST input image) wearing EVERY item extracted from IMAGE 1 (main fullset).
The model in the output must look exactly like the model in the last input image!
`;
            } else {
                // === MIX & MATCH MODE: Individual items with EXPLICIT SEGMENTATION ===
                const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth"];
                let itemIndex = 0;

                // Track what items are being provided
                const itemsProvided: string[] = [];

                // Fullset item is provided but with other items - treat as skirt/dress
                if (skirtImage) {
                    const skirtPart = await urlToGenerativePart(skirtImage);
                    parts.push(skirtPart);
                    itemsProvided.push('skirt');
                    itemIndex++;
                }

                if (topImage) {
                    const topPart = await urlToGenerativePart(topImage);
                    parts.push(topPart);
                    itemsProvided.push('top');
                    itemIndex++;
                }
                if (bottomImage) {
                    const bottomPart = await urlToGenerativePart(bottomImage);
                    parts.push(bottomPart);
                    itemsProvided.push('bottom');
                    itemIndex++;
                }
                if (shoesImage) {
                    const shoesPart = await urlToGenerativePart(shoesImage);
                    parts.push(shoesPart);
                    itemsProvided.push('shoes');
                    itemIndex++;
                }
                if (jewelryImage) {
                    const jewelryPart = await urlToGenerativePart(jewelryImage);
                    parts.push(jewelryPart);
                    itemsProvided.push('jewelry');
                    itemIndex++;
                }
                if (bagImage) {
                    const bagPart = await urlToGenerativePart(bagImage);
                    parts.push(bagPart);
                    itemsProvided.push('bag');
                    itemIndex++;
                }

                const modelPart = await fileToGenerativePart(modelFile);
                parts.push(modelPart);

                // Build explicit segmentation instructions
                let segmentationInstructions = '';

                if (itemsProvided.includes('top')) {
                    segmentationInstructions += `
- TOP REFERENCE (${ordinals[itemsProvided.indexOf('top')]}th image):
  * SEGMENT ONLY: Upper body garment ONLY (shirt, blouse, jacket, top, sweater, coat)
  * REMOVE: Everything else - background, person's body, other clothing items
  * TARGET: Apply ONLY to the model's upper body/chest area
  * DO NOT: Copy the person's body, legs, or full outfit from this reference
`;
                }

                if (itemsProvided.includes('bottom')) {
                    segmentationInstructions += `
- BOTTOM REFERENCE (${ordinals[itemsProvided.indexOf('bottom')]}th image):
  * SEGMENT ONLY: Lower body garment ONLY (pants, trousers, jeans, shorts, skirt)
  * REMOVE: Everything else - background, person's body, upper body clothing
  * TARGET: Apply ONLY to the model's hip/leg area
  * DO NOT: Copy the person's upper body, torso, or full outfit from this reference
`;
                }

                if (itemsProvided.includes('skirt')) {
                    segmentationInstructions += `
- SKIRT/DRESS REFERENCE (${ordinals[itemsProvided.indexOf('skirt')]}th image):
  * SEGMENT ONLY: Skirt or dress ONLY
  * REMOVE: Everything else - background, person's body, other clothing
  * TARGET: Apply to the model's lower body/waist area
  * DO NOT: Copy full body or other items from this reference
`;
                }

                if (itemsProvided.includes('shoes')) {
                    segmentationInstructions += `
- SHOES REFERENCE (${ordinals[itemsProvided.indexOf('shoes')]}th image):
  * SEGMENT ONLY: Footwear ONLY (shoes, sneakers, sandals, boots)
  * REMOVE: Everything else - background, person's legs
  * TARGET: Apply to the model's feet area
  * DO NOT: Copy legs or full body from this reference
`;
                }

                if (itemsProvided.includes('jewelry')) {
                    segmentationInstructions += `
- JEWELRY REFERENCE (${ordinals[itemsProvided.indexOf('jewelry')]}th image):
  * SEGMENT ONLY: Jewelry items ONLY (necklace, earrings, bracelet, ring, glasses)
  * REMOVE: Everything else
  * TARGET: Apply to appropriate body area (neck for necklace, ears for earrings, etc.)
`;
                }

                if (itemsProvided.includes('bag')) {
                    segmentationInstructions += `
- BAG REFERENCE (${ordinals[itemsProvided.indexOf('bag')]}th image):
  * SEGMENT ONLY: Bag/handbag ONLY
  * REMOVE: Everything else
  * TARGET: Position naturally on model's hand, shoulder, or beside model
`;
                }

                instructions += `MODE: EXPLICIT SEGMENTATION & TRANSFER

CRITICAL - IMAGE ORDER:
- FIRST images: Reference clothing items (top, bottom, skirt, shoes, jewelry, bag)
- LAST image: TARGET MODEL (the person who will wear all the items)

MISSION: Take the CLOTHES from reference images and TRANSFER them onto the MODEL in the last image.
The OUTPUT must show the MODEL from the last image wearing all the transferred clothing items.

INPUT:
- Reference images (1-N): Individual clothing items to transfer
- Target image (last): Model who will receive the clothing

CRITICAL INSTRUCTIONS:
1. START WITH THE MODEL: The output must show the PERSON from the LAST image (model)
2. REMOVE the model's original clothing ENTIRELY
3. TRANSFER each clothing item from its reference image to the model
4. PRESERVE the model's face, skin, hair, and body shape EXACTLY
5. APPLY all selected items - don't skip any

SEGMENTATION INSTRUCTIONS:
${segmentationInstructions}

COMPOSITION RULES:
1. The output image must be of the MODEL (last image) wearing the transferred items
2. The model's face, expression, and body must remain IDENTICAL to the last image
3. Each clothing item comes from its own reference image
4. DO NOT copy body parts from reference images
5. Match lighting, shadows, and proportions naturally

${poseInstruction}

${backgroundInstruction}

${fullBodyInstruction}

OUTPUT REQUIREMENT:
The FINAL OUTPUT must be a photorealistic image of THE MODEL (from the last image) wearing:
- The TOP from TOP reference (if provided) - on the model's upper body
- The BOTTOM from BOTTOM reference (if provided) - on the model's lower body
- The SKIRT from SKIRT reference (if provided) - on the model's lower body
- SHOES from SHOES reference (if provided) - on the model's feet
- JEWELRY from JEWELRY reference (if provided) - on model's appropriate body part
- BAG from BAG reference (if provided) - in model's hand or on shoulder

The model in the output must look like the model in the last input image!
`;
            }

            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: { parts: [...parts, { text: instructions }] },
                config: {
                    responseModalities: [Modality.IMAGE],
                    imageConfig: {
                        aspectRatio: generationSettings.aspectRatio
                    }
                },
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                setFinalImage(`data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`);
            } else {
                throw new Error("AI không thể tạo ảnh. Vui lòng thử lại hoặc đổi Model.");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Lỗi ghép đồ.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFixSkin = async (inputFile?: File | null) => {
        const fileToUse = inputFile instanceof File ? inputFile : skinFile;

        if (!checkProviderReady()) return;

        if (!fileToUse) {
            setError('Vui lòng tải ảnh cần xử lý.');
            return;
        }

        // Validate file before processing
        if (fileToUse instanceof File) {
            if (fileToUse.size === 0) {
                setError('File ảnh trống. Vui lòng tải lại.');
                return;
            }
            if (!fileToUse.type.startsWith('image/')) {
                setError('File không phải là ảnh hợp lệ.');
                return;
            }
        }

        setIsFixingSkin(true);
        setError(null);
        setSkinResult(null);

        try {
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });

            console.log('Processing skin fix with file:', fileToUse instanceof File ? fileToUse.name : 'non-File', 'type:', typeof fileToUse);
            const imagePart = await fileToGenerativePart(fileToUse, 'handleFixSkin');

            // === LIGHTWEIGHT PLASTICITY REMOVAL SYSTEM ===
            const prompt = `
SYSTEM_PROMPT: You are a professional image enhancement engine specializing in subtle skin texture restoration.

================================================================================
OBJECTIVE
================================================================================
Remove the "plastic/waxy" over-smoothed look from AI-generated images while
keeping the skin NATURAL, GLOWING, and BEAUTIFUL. The result should look like
a high-quality professional photo with natural skin texture.

================================================================================
KEY PRINCIPLE: LIGHT TOUCH
================================================================================
- LESS is MORE: Subtle improvements are better than heavy corrections
- PRESERVE the original brightness and skin tone
- PRESERVE the natural glow and radiance of the skin
- PRESERVE the original contrast (don't make skin flat or dark)
- The skin should look healthier and more natural, NOT aged or darkened

================================================================================
PHASE 1: FACE PARSING & IDENTIFICATION
================================================================================
1. Identify facial skin regions: cheeks, forehead, chin
2. Identify and PROTECT: eyes, lips, nose, eyebrows, hair (do not alter)
3. Lock the original skin tone, brightness, and color as reference

CRITICAL: The output must have the SAME skin tone and brightness as the input.

================================================================================
PHASE 2: PLASTICITY DETECTION (Gentle Assessment)
================================================================================
2. Analyze the skin to find:
   - Areas that look too smooth/waxy (plastic look)
   - Areas that need subtle texture restoration

BE GENTLE:
- Only fix areas with obvious plastic appearance
- Keep naturally smooth areas untouched
- Avoid over-correction that makes skin look rough or dirty

================================================================================
PHASE 3: SUBTLE TEXTURE RESTORATION (Key Phase)
================================================================================
3. Add very subtle, natural skin texture:
   - Very fine, barely visible pores
   - Barely noticeable skin texture
   - Subtle variation between skin zones

IMPORTANT: The texture should be INVISIBLE at normal viewing distance.
Only visible when zoomed in significantly.

DO NOT:
- Add visible wrinkles or skin imperfections
- Add rough, aged skin texture
- Darken or dull the skin
- Create visible texture patterns

================================================================================
PHASE 4: LIGHTING PRESERVATION (Critical)
================================================================================
4. KEEP the original lighting exactly as is:
   - Same brightness and exposure
   - Same highlights and shadows
   - Same overall contrast
   - Same skin radiance and glow

The goal is to add texture WITHOUT changing the lighting.

CORRECT: "Add subtle texture while preserving original lighting"
WRONG: "Redo the lighting" or "Add shadow variations"

================================================================================
PHASE 5: BLENDING
================================================================================
5. Seamlessly blend the subtle texture with the original:
   - No visible edges or borders
   - Perfect match with original skin tone
   - Natural transition between different skin areas

================================================================================
STRICT CONSTRAINTS (Non-Negotiable)
================================================================================
✅ PRESERVE original skin tone exactly (same color, same brightness)
✅ PRESERVE original lighting (same exposure, contrast, highlights)
✅ PRESERVE original facial features (nose, eyes, jawline, expression)
✅ PRESERVE original hair, makeup, accessories

✅ RESULT: Skin should look NATURAL, HEALTHY, and RADIANT
✅ RESULT: The "plastic/waxy" look should be reduced or eliminated
✅ RESULT: Skin should have subtle, natural texture (barely visible)

❌ DO NOT darken or dull the skin
❌ DO NOT reduce skin radiance or glow
❌ DO NOT add visible imperfections or wrinkles
❌ DO NOT change skin color or tone
❌ DO NOT alter facial features
❌ DO NOT make skin look aged, rough, or dirty

================================================================================
NEGATIVE PROMPT
================================================================================
"dark skin", "dull skin", "aged skin", "rough skin", "dirty skin",
"visible wrinkles", "prominent pores", "skin imperfections",
"plastic skin", "wax skin", "airbrushed", "blurry", "unnatural",
"overprocessed", "CGI look", "3D render look"

================================================================================
MISSION
================================================================================
Take the input image and REMOVE the plastic/artificial look while KEEPING:
- Natural skin radiance and glow
- Original brightness and exposure
- Healthy, beautiful appearance
- Subtle natural texture (barely visible)

The result should look like a professional photo with naturally beautiful skin.

OUTPUT:
A beautiful, natural-looking photo where the skin has been subtly enhanced
to remove the artificial plastic look while maintaining all original qualities.
`;

            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: {
                    parts: [imagePart, { text: prompt }],
                },
                config: { responseModalities: [Modality.IMAGE] },
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                setSkinResult(`data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`);
            } else {
                throw new Error("Không thể xử lý ảnh. Vui lòng thử lại với ảnh khác.");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Lỗi xử lý ảnh.');
        } finally {
            setIsFixingSkin(false);
        }
    };

    const handleBreastAugmentation = async (inputFile?: File | null) => {
        const fileToUse = inputFile instanceof File ? inputFile : breastAugFile;

        if (!checkProviderReady()) return;

        if (!fileToUse) {
            setError('Vui lòng tải ảnh nhân vật.');
            return;
        }

        // Validate file before processing
        if (fileToUse instanceof File) {
            if (fileToUse.size === 0) {
                setError('File ảnh trống. Vui lòng tải lại.');
                return;
            }
            if (!fileToUse.type.startsWith('image/')) {
                setError('File không phải là ảnh hợp lệ.');
                return;
            }
        }

        setIsBreastAugmenting(true);
        setError(null);
        setBreastAugResult(null);

        try {
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });

            console.log('Processing breast aug with file:', fileToUse instanceof File ? fileToUse.name : 'non-File', 'type:', typeof fileToUse);
            const imagePart = await fileToGenerativePart(fileToUse, 'handleBreastAugmentation');
            const prompt = `
            ACT AS: Professional Photo Retoucher specializing in body aesthetics and natural enhancement.
            TASK: Naturally enhance the breast size and firmness of the person in the image.

            INSTRUCTIONS:
            1.  **Volumetric Enhancement:** Increase the breast volume to look fuller, rounder, and more lifted (approximately 1-2 cup sizes larger, or what is proportionally attractive for the body type).
            2.  **Natural Shape & Gravity:** Ensure the shape follows natural physics. They should look firm and perky but not like rigid plastic spheres.
            3.  **Clothing Adaptation:** Accurately adjust the clothing to fit the new volume. Create realistic fabric tension, stretch marks on fabric, and shadow casting based on the new contours.
            4.  **Cleavage & Shadowing:** Enhance the cleavage depth and lighting naturally if visible.

            STRICT CONSTRAINTS (Identity & Scene Preservation):
            - **IDENTITY LOCK:** The face, hair, makeup, expression, and skin tone MUST remain 100% IDENTICAL to the original.
            - **BACKGROUND LOCK:** Do not change or warp the background.
            - **STYLE LOCK:** Keep the original clothing style, color, and texture. Only the fit changes.
            - **REALISM:** The result must be photorealistic, matching the lighting and grain of the original photo. No cartoon/anime style unless the input is such.

            OUTPUT:
            A high-quality, photorealistic image with the requested enhancement.
            `;

            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: {
                    parts: [imagePart, { text: prompt }],
                },
                config: { responseModalities: [Modality.IMAGE] },
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                setBreastAugResult(`data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`);
            } else {
                throw new Error("Không thể xử lý ảnh. Vui lòng thử lại với ảnh khác.");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Lỗi xử lý ảnh.');
        } finally {
            setIsBreastAugmenting(false);
        }
    };

    // Continue augmentation using the previous result as input
    const handleContinueAugmentation = async () => {
        if (!breastAugResult) {
            setError('Không có kết quả để tiếp tục nâng.');
            return;
        }

        try {
            // Convert data URL to File
            const file = await dataUrlToFile(breastAugResult, 'breast-aug-continue.png');
            if (file) {
                // Set the result as the new input
                setBreastAugFile(file);
                setBreastAugPreview(breastAugResult);
                // Clear the result so user can process again
                setBreastAugResult(null);
                setError(null);
                // Auto-trigger augmentation
                setTimeout(() => {
                    handleBreastAugmentation(file);
                }, 100);
            } else {
                setError('Không thể xử lý ảnh. Vui lòng thử lại.');
            }
        } catch (err) {
            setError('Không thể tiếp tục nâng. Vui lòng thử lại.');
        }
    };

    // AI Generate Clothing Function
    const handleAIGenerateClothing = async () => {
        if (!selectedAIClothing) {
            setError('Vui lòng chọn loại trang phục!');
            return;
        }

        setIsGeneratingClothing(true);
        setError(null);
        setAiGeneratedClothing(null);

        try {
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });

            const fallbackModels = apiSettings.provider === 'gemini'
                ? (selectedModel === 'gemini-3-pro-image-preview'
                    ? ['gemini-3-flash-preview']
                    : ['gemini-3-pro-image-preview'])
                : [];

            // Find the selected clothing option
            const clothingOption = aiClothingOptions.find(opt => opt.id === selectedAIClothing);
            if (!clothingOption) {
                throw new Error('Không tìm thấy trang phục đã chọn');
            }

            console.log('AI Generating Clothing:', clothingOption.name);

            // Build prompt for clothing generation
            const prompt = `You are a professional fashion photographer and designer.

MISSION: Generate a high-quality, photorealistic image of ${clothingOption.description}.

REQUIREMENTS:
- Detailed, fashion-forward ${clothingOption.category} piece
- High-quality fabric texture and draping
- Professional studio lighting
- Clean, minimalist background (solid color)
- Photorealistic, 4K quality
- Natural shadows and highlights
- The clothing should look like it's ready to be worn
- Detailed stitching, patterns, and design elements visible

OUTPUT: A single, high-quality image of the ${clothingOption.name} on a transparent/white background, centered and well-lit.`;

            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: {
                    parts: [{ text: prompt }],
                },
                config: { responseModalities: [Modality.IMAGE] },
                fallbackModels
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                const generatedImage = `data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`;
                setAiGeneratedClothing(generatedImage);
            } else {
                throw new Error("Không thể tạo trang phục. Vui lòng thử lại.");
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
            const overloadMessage = isOverloadedError(err)
                ? 'Model is overloaded (503). Please retry or switch model in Settings.'
                : null;
            console.error('AI clothing generation error:', err);
            setError(`Tạo trang phục thất bại: ${errorMessage}`);
            if (overloadMessage) {
                setError(`Tạo trang phục thất bại: ${overloadMessage}`);
            }
        } finally {
            setIsGeneratingClothing(false);
        }
    };

    // Apply AI generated clothing to try-on
    const applyAIGeneratedClothing = (type: 'top' | 'bottom' | 'skirt') => {
        if (!aiGeneratedClothing) {
            setError('Chưa có trang phục được tạo!');
            return;
        }

        if (type === 'top') {
            setTopImage(aiGeneratedClothing);
        } else if (type === 'bottom') {
            setBottomImage(aiGeneratedClothing);
        } else if (type === 'skirt') {
            setSkirtImage(aiGeneratedClothing);
        }

        setAiGeneratedClothing(null);
        setSelectedAIClothing(null);
    };

    // Face Swap Function
    const handleFaceSwap = async () => {
        if (!modelFile || !faceSourceFile) {
            setError('Vui lòng tải lên cả ảnh nhân vật chính và ảnh khuôn mặt!');
            return;
        }

        setIsSwapping(true);
        setError(null);

        try {
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });

            const fallbackModels = apiSettings.provider === 'gemini'
                ? (selectedModel === 'gemini-3-pro-image-preview'
                    ? ['gemini-3-flash-preview']
                    : ['gemini-3-pro-image-preview'])
                : [];

            // Determine source and target based on hot-swap
            const targetFile = isHotSwap ? faceSourceFile : modelFile;
            const sourceFile = isHotSwap ? modelFile : faceSourceFile;

            console.log('Face Swap - Target (body):', targetFile?.name);
            console.log('Face Swap - Source (face):', sourceFile?.name);

            // Prepare image parts
            const targetPart = await fileToGenerativePart(targetFile, 'face-swap-target');
            const sourcePart = await fileToGenerativePart(sourceFile, 'face-swap-source');

            // Build generation instruction
            const poseInstruction = generationSettings.changePose
                ? '- Thay đổi tư thế của nhân vật cho phù hợp'
                : '- Giữ nguyên tư thế và pose của nhân vật gốc';

            const expressionInstruction = generationSettings.changeExpression
                ? '- Thay đổi biểu cảm khuôn mặt theo ảnh khuôn mặt nguồn'
                : '- Giữ nguyên biểu cảm tự nhiên của khuôn mặt';

            const backgroundInstruction = generationSettings.transparentBackground
                ? '- Tạo nền TRONG SUỐT (transparent), không có background'
                : generationSettings.changeBackground
                    ? '- Tạo background mới, sạch sẽ và chuyên nghiệp'
                    : '- Giữ nguyên background gốc của ảnh nhân vật';

            const prompt = `Bạn là chuyên gia AI về chỉnh sửa ảnh và face swap chuyên nghiệp.

NHIỆM VỤ: Thay thế khuôn mặt của nhân vật trong ảnh đầu tiên bằng khuôn mặt TỪ ẢNH THỨ HAI. ĐẢM BẢO LẤY CHÍNH XÁC KHUÔN MẶT TỪ ẢNH KHUÔN MẶT NGUỒN.

QUY TRÌNH XỬ LÝ CHÍNH XÁC:
1. PHÂN TÍCH KHUÔN MẶT NGUỒN (từ ảnh thứ 2):
   - XÁC ĐỊNH CHÍNH XÁC vùng khuôn mặt trong ảnh
   - TRÍCH XUẤT CHÍNH XÁC các đặc điểm sau:
     + Hình dạng khuôn mặt (oval, vuông, trái xoan, dài, tròn)
     + Đường viền xương gò má, xương hàm, cằm
     + Hình dạng và kích thước mắt (mắt hạnh nhân, mắt tròn, kích thước lớn/nhỏ)
     + Đường cong lông mày (cao/thấp, dày/mỏng, hình dạng)
     + Hình dạng mũi (thẳng, gồ, rộng, hẹp, chiều dài)
     + Hình dạng và độ dày môi (môi dày/mỏng, rộng/hẹp, độ cong)
     + Màu da chính xác (tông màu, độ sáng/tối)
     + Kết cấu da (mịn, thô, có đốm, tàn nhang)
     + Màu và kiểu tóc (màu tự nhiên, màu nhuộm, độ dài, kiểu dáng)
     + Đặc điểm nhận dạng (nốt ruồi, sẹo, nếp nhăn nếu có)

2. NHẬN DIỆN VÙNG KHUÔN MẶT TRONG ẢNH ĐÍCH (ảnh thứ 1):
   - Xác định chính xác vị trí và ranh giới khuôn mặt cần thay thế
   - Đánh giá góc độ và hướng khuôn mặt hiện tại

3. THAY THẾ KHUÔN MẶT CHÍNH XÁC:
   - Áp dụng TẤT CẢ các đặc điểm khuôn mặt nguồn đã trích xuất
   - Giữ nguyên tỷ lệ khuôn mặt phù hợp với cơ thể đích
   - Điều chỉnh góc độ khuôn mặt nguồn cho khớp với tư thế cơ thể
   - Blend mượt mà vùng da xung quanh, không để lại đường viền
   - Giữ nguyên TỐI ĐA phần thân, trang phục, phụ kiện của ảnh gốc

4. TỐI ƯU CHẤT LƯỢNG:
   ${poseInstruction}
   ${expressionInstruction}
   ${backgroundInstruction}
   - Ánh sáng và bóng đổ phải tự nhiên, đồng nhất với ảnh gốc
   - Độ phân giải cao, chi tiết sắc nét (4K quality)
   - Da có kết cấu tự nhiên, KHÔNG bị "da nhựa" hay quá mịn ảo
   - Màu sắc hài hòa, khớp với tông màu tổng thể

QUY TẮC QUAN TRỌNG TUYỆT ĐỐI:
- CHỈ thay đổi KHUÔN MẶT, KHÔNG thay đổi cơ thể, trang phục, hình dáng
- GIỮ NGUYÊN danh tính và hình dáng cơ thể của nhân vật gốc
- Đảm bảo tỷ lệ khuôn mặt PHÙ HỢP VÀ CÂN ĐỐI với cơ thể
- Kết quả phải TỰ NHIÊN, không có dấu hiệu chỉnh sửa
- Khuôn mặt mới phải GIỐNG CHÍNH XÁC khuôn mặt nguồn trong ảnh thứ 2

TRÍCH XUẤT KHUÔN MẶT NGUỒN (nguồn khuôn mặt - ảnh thứ 2):`;

            const contents = {
                parts: [
                    { text: prompt },
                    sourcePart,
                    { text: '\n\nĐÂY LÀ ẢNH NHÂN VẬT CẦN ĐỔI KHUÔN MẶT (ảnh đích):' },
                    targetPart
                ]
            };

            const response = await generateImageWithRetry({
                ai,
                model: selectedModel,
                contents,
                config: { responseModalities: [Modality.IMAGE] },
                fallbackModels
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                setSwapResult(`data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`);
            } else {
                throw new Error("Không thể xử lý ảnh. Vui lòng thử lại với ảnh khác.");
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
            const overloadMessage = isOverloadedError(err)
                ? 'Model is overloaded (503). Please retry or switch model in Settings (try gemini-3-flash-preview).'
                : null;
            console.error('Face swap error:', err);
            setError(`Face swap thất bại: ${errorMessage}`);
            if (overloadMessage) {
                setError(`Face swap that bai: ${overloadMessage}`);
            }
        } finally {
            setIsSwapping(false);
        }
    };

    // Change Background Handler
    const handleChangeBackground = async () => {
        if (!bgSourceFile) {
            setError('Vui lòng tải lên ảnh người mẫu!');
            return;
        }
        if (!customBgFile && !selectedBackground) {
            setError('Vui lòng chọn hoặc tải lên bối cảnh!');
            return;
        }

        setIsChangingBg(true);
        setError(null);

        try {
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });

            const fallbackModels = apiSettings.provider === 'gemini'
                ? (selectedModel === 'gemini-3-pro-image-preview'
                    ? ['gemini-3-flash-preview']
                    : ['gemini-3-pro-image-preview'])
                : [];

            console.log('Change Background - Source:', bgSourceFile?.name);

            // Prepare image parts
            const sourcePart = await fileToGenerativePart(bgSourceFile, 'bg-change-source');

            // Get background name for the prompt
            let bgName = 'bối cảnh mới';
            let bgDescription = '';
            let isTransparent = false;
            
            if (customBgFile) {
                bgName = 'nền tùy chỉnh được tải lên';
                bgDescription = 'Sử dụng chính xác nền được cung cấp';
            } else if (selectedBackground === 'random') {
                bgName = 'bối cảnh ngẫu nhiên';
                bgDescription = 'Tự động chọn bối cảnh đẹp và phù hợp với trang phục';
            } else if (selectedBackground === 'transparent') {
                isTransparent = true;
                bgName = 'NỀN TRONG SUỐNG (transparent background)';
            } else {
                const preset = backgroundPresets.find(b => b.id === selectedBackground);
                if (preset) {
                    bgName = preset.name;
                    bgDescription = preset.desc;
                }
            }

            // Build generation instruction
            const poseInstruction = generationSettings.changePose
                ? 'QUAN TRỌNG - THAY ĐỔI TƯ THẾ: Đặt nhân vật vào pose/thái độ phù hợp với bối cảnh mới. Nếu là bãi biển thì đứng thoải mái, nếu là phòng gym thì tạo dáng tập, nếu là văn phòng thì đứng/chỗ ngồi chuyên nghiệp. Tạo pose tự nhiên, phù hợp với không gian.'
                : '- Giữ nguyên tư thế và pose của nhân vật gốc';

            const expressionInstruction = generationSettings.changeExpression
                ? 'QUAN TRỌNG - THAY ĐỔI BIỂU CẢM: Tạo biểu cảm khuôn mặt phù hợp với không khí của bối cảnh. Nếu là bãi biển thì vui vẻ, thư giãn; nếu là văn phòng thì nghiêm túc, chuyên nghiệp; nếu là quán cà phê thì nhẹ nhàng, thoải mái. Biểu cảm tự nhiên, mắt mở rõ, miệng cười nhẹ hoặc neutral.'
                : '- Giữ nguyên biểu cảm khuôn mặt tự nhiên';

            const fullBodyInstruction = generationSettings.generateFullBody
                ? 'QUAN TRỌNG: Hiển thị ĐẦY ĐỦ TOÀN THÂN nhân vật từ đầu đến chân, không cắt cụt. Nếu ảnh gốc chỉ có nửa thân, HÃY TÁI TẠO phần còn thiếu để có ảnh toàn thân hoàn chỉnh.'
                : '- Giữ nguyên phần thân hiển thị trong ảnh gốc';

            const prompt = `Bạn là chuyên gia AI về chỉnh sửa ảnh và thay đổi background chuyên nghiệp.

NHIỆM VỤ: ${isTransparent ? 'Tạo ảnh với NỀN TRONG SUỐT (transparent background), chỉ giữ lại nhân vật' : `Đặt nhân vật trong ảnh vào ${bgName} mới`}

${fullBodyInstruction}

${poseInstruction}

${expressionInstruction}

QUY TRÌNH XỬ LÝ:
1. PHÂN TÍCH:
   - Nhận diện chính xác nhân vật trong ảnh (bao gồm tóc, trang phục, phụ kiện)
   - Tách nhân vật ra khỏi nền gốc một cách sạch sẽ
   - Đánh giá đặc điểm trang phục và phong cách nhân vật

2. ÁP DỤNG VÀO BỐI CẢNH MỚI:
   ${isTransparent 
      ? '- Tạo nền TRONG SUỐT, loại bỏ hoàn toàn background, chỉ giữ lại nhân vật với viền sạch' 
      : customBgFile 
          ? `- Sử dụng chính xác ảnh nền được cung cấp, đặt nhân vật vào đúng vị trí phù hợp`
          : selectedBackground === 'random' 
              ? `- Tự động chọn và tạo bối cảnh đẹp, chuyên nghiệp, phù hợp với nhân vật`
              : `- Tạo ${bgName}: ${bgDescription}`}
   - Đảm bảo nhân vật hòa hợp tự nhiên với không gian mới
   - Điều chỉnh kích thước và tỷ lệ nhân vật phù hợp với bối cảnh
   - Nếu cần tạo toàn thân, tái tạo phần chân còn thiếu một cách tự nhiên

3. TỐI ƯU CHẤT LƯỢNG:
   - Ánh sáng và bóng đổ tự nhiên, phù hợp với không gian mới
   - Độ phân giải cao, chi tiết sắc nét
   - Màu sắc hài hòa giữa nhân vật và bối cảnh

QUY TẮC QUAN TRỌNG:
- Giữ nguyên DANH TÍNH, HÌNH DÁNG CƠ THỂ và TRANG PHỤC của nhân vật gốc
- Chỉ thay đổi bối cảnh nền, KHÔNG thay đổi cơ thể, trang phục, khuôn mặt
- Kết quả phải tự nhiên, không có dấu hiệu ghép nối
- Da có kết cấu tự nhiên, không bị "da nhựa" hay quá mịn
- Nếu có nền trong suốt, đảm bảo viền nhân vật sạch sẽ, không có bóng hay vết cắt

ĐÂY LÀ ẢNH NHÂN VẬT CẦN ĐẶT VÀO BỐI CẢNH MỚI:`;

            let contents: any = {
                parts: [
                    { text: prompt },
                    sourcePart
                ]
            };

            // Add custom background if uploaded
            if (customBgFile) {
                const bgPart = await fileToGenerativePart(customBgFile, 'bg-change-custom-bg');
                contents.parts.push({ text: '\n\nĐÂY LÀ ẢNH NỀN MUỐN SỬ DỤNG:' });
                contents.parts.push(bgPart);
            } else if (selectedBackground !== 'random') {
                // Add reference to selected background style
                const preset = backgroundPresets.find(b => b.id === selectedBackground);
                if (preset) {
                    contents.parts.push({ text: `\n\nYÊU CẦU BỐI CẢNH: Tạo ${preset.name} với phong cách ${preset.desc}` });
                }
            }

            const response = await generateImageWithRetry({
                ai,
                model: selectedModel,
                contents,
                config: { responseModalities: [Modality.IMAGE] },
                fallbackModels
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                setBgResult(`data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`);
            } else {
                throw new Error("Không thể xử lý ảnh. Vui lòng thử lại với ảnh khác.");
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
            const overloadMessage = isOverloadedError(err)
                ? 'Model is overloaded (503). Please retry or switch model in Settings (try gemini-3-flash-preview).'
                : null;
            console.error('Change background error:', err);
            setError(`Thay đổi bối cảnh thất bại: ${errorMessage}`);
            if (overloadMessage) {
                setError(`Thay đổi bối cảnh thất bại: ${overloadMessage}`);
            }
        } finally {
            setIsChangingBg(false);
        }
    };

    // AI Influencer Generation Function
    const handleGenerateInfluencer = async () => {
        setIsGeneratingInfluencer(true);
        setError(null);
        setInfluencerResult(null);

        try {
            const activeKey = getActiveKey(apiSettings.provider);
            const selectedModel = apiSettings.models[apiSettings.provider];
            const ai = new GoogleGenAI({ apiKey: activeKey! });
            const fallbackModels = apiSettings.provider === 'gemini'
                ? (selectedModel === 'gemini-3-pro-image-preview'
                    ? ['gemini-3-flash-preview']
                    : ['gemini-3-pro-image-preview'])
                : [];

            const refInstructions = buildInfluencerRefInstructions();
            const prompt = influencerPrompt.trim()
                ? influencerPrompt
                : buildInfluencerPrompt(refInstructions);

            const parts: any[] = [];
            if (influencerRefFile) {
                const refPart = await fileToGenerativePart(influencerRefFile, 'influencer-reference');
                if (refPart) {
                    parts.push(refPart);
                }
            }
            parts.push({ text: prompt });

            const contents = {
                parts
            };

            const response = await ai.models.generateContent({
                model: selectedModel,
                contents: contents,
                config: {
                    responseModalities: [Modality.IMAGE],
                    imageConfig: {
                        aspectRatio: influencerAspectRatio
                    }
                },
            });

            const firstPart = response.candidates?.[0]?.content?.parts?.[0];
            if (firstPart && firstPart.inlineData) {
                setInfluencerResult(`data:${firstPart.inlineData.mimeType};base64,${firstPart.inlineData.data}`);
            } else {
                throw new Error("Không thể tạo influencer. Vui lòng thử lại.");
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
            console.error('Influencer generation error:', err);
            setError(`Tạo AI Influencer thất bại: ${errorMessage}`);
        } finally {
            setIsGeneratingInfluencer(false);
        }
    };

    const handleDownload = (imageUrl: string | null, filenamePrefix: string, quality: 'original' | 'hd' | '2k' | '4k') => {
        if (!imageUrl) {
            console.error('Download failed: No image URL provided');
            return;
        }

        // Generate timestamp suffix (format: DDMMYYHHMMSS -> e.g., 230125103026)
        const now = new Date();
        const timestamp = `${now.getDate().toString().padStart(2, '0')}${now.getMonth().toString().padStart(2, '0')}${now.getFullYear().toString().slice(-2)}${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;

        const resolutions: Record<string, number> = { hd: 1920, '2k': 2560, '4k': 3840 };

        const triggerDownload = (href: string, filename: string) => {
            const link = document.createElement('a');
            link.href = href;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        if (quality === 'original') {
            triggerDownload(imageUrl, `${filenamePrefix}-${timestamp}.png`);
            return;
        }

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    console.error('Failed to get canvas context');
                    return;
                }
                const target = resolutions[quality];
                const ratio = img.width / img.height;
                canvas.width = img.width >= img.height ? target : target * ratio;
                canvas.height = img.width >= img.height ? target / ratio : target;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/png');
                triggerDownload(dataUrl, `${filenamePrefix}-${quality}-${timestamp}.png`);
            } catch (err) {
                console.error('Canvas drawing error:', err);
                // Fallback to original quality
                triggerDownload(imageUrl, `${filenamePrefix}-${timestamp}.png`);
            }
        };
        img.onerror = () => {
            console.error('Failed to load image for download');
            // Fallback to original quality
            triggerDownload(imageUrl, `${filenamePrefix}-${timestamp}.png`);
        };
        img.src = imageUrl;
    };

    return (
        <>
            <header className="app-header">
                <h1>AI Studio VIP</h1>
                <p>Bộ công cụ xử lý ảnh chuyên nghiệp</p>
                <div className="header-actions">
                    <button 
                        className="btn btn-secondary" 
                        style={{ width: 'auto', padding: '8px 16px', fontSize: '0.9rem' }}
                        onClick={() => setIsSettingsOpen(true)}
                    >
                        ⚙️ Cài đặt AI
                    </button>
                    <button
                        className="btn btn-secondary"
                        style={{ width: 'auto', padding: '8px 16px', fontSize: '0.9rem' }}
                        onClick={() => setIsGuideOpen(true)}
                    >
                        📘 Hướng dẫn
                    </button>
                </div>
            </header>

            <SettingsModal 
                isOpen={isSettingsOpen} 
                onClose={() => setIsSettingsOpen(false)} 
                settings={apiSettings} 
                onSave={handleSaveSettings} 
            />
            <GuideModal
                isOpen={isGuideOpen}
                onClose={() => setIsGuideOpen(false)}
            />

            <div className="tab-navigation">
                <button
                    className={`tab-btn ${activeTab === 'ai-influencer' ? 'active' : ''}`}
                    onClick={() => handleTabChange('ai-influencer')}
                >
                    👤 AI Influencer
                </button>
                <button
                    className={`tab-btn ${activeTab === 'change-background' ? 'active' : ''}`}
                    onClick={() => handleTabChange('change-background')}
                >
                    🏞️ Đổi Bối Cảnh
                </button>
                <button
                    className={`tab-btn ${activeTab === 'swap-face' ? 'active' : ''}`}
                    onClick={() => handleTabChange('swap-face')}
                >
                    🔄 Swap Face
                </button>
                <button
                    className={`tab-btn ${activeTab === 'try-on' ? 'active' : ''}`}
                    onClick={() => handleTabChange('try-on')}
                >
                    👗 Virtual Try-On
                </button>
                <button
                    className={`tab-btn ${activeTab === 'skin-fix' ? 'active' : ''}`}
                    onClick={() => handleTabChange('skin-fix')}
                >
                    ✨ Fix Da Nhựa
                </button>
                <button
                    className={`tab-btn ${activeTab === 'breast-aug' ? 'active' : ''}`}
                    onClick={() => handleTabChange('breast-aug')}
                >
                    👙 AI Nâng Ngực
                </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            {activeTab === 'try-on' && (
                <main className="workflow-container">
                    {/* Step 1: Upload Clothes & Model */}
                    <section className="step-card full-width">
                        <h2>
                            <span className="step-number">1</span>
                            Tải Trang Phục & Người Mẫu
                        </h2>

                        {/* Model Upload Section */}
                        <div className="model-section">
                            <h3 className="subsection-title">📷 Ảnh Người Mẫu (Bắt buộc)</h3>
                            <div className="model-upload-container">
                                <ImageUploader
                                    label="Người mẫu (Model)"
                                    image={modelPreview}
                                    onImageSelect={(e) => handleFileChange(e, setModelFile, setModelPreview)}
                                    onRemove={() => { setModelFile(null); setModelPreview(null); }}
                                >
                                    <p>+ Tải ảnh người mẫu</p>
                                </ImageUploader>
                            </div>
                        </div>

                        {/* AI Clothing Generator Section */}
                        <div className="ai-clothing-section">
                            <h3 className="subsection-title">✨ Tạo Trang Phục Bằng AI (Tùy chọn)</h3>
                            <p className="section-hint">Chọn trang phục từ danh sách, AI sẽ tự tạo ảnh trang phục cho bạn</p>

                            <div className="ai-clothing-controls">
                                <div className="clothing-select-wrapper">
                                    <select
                                        className="ai-clothing-select"
                                        value={selectedAIClothing || ''}
                                        onChange={(e) => setSelectedAIClothing(e.target.value || null)}
                                    >
                                        <option value="">-- Chọn loại trang phục --</option>
                                        <optgroup label="🔥 Trang Phục Gợi Cảm">
                                            <option value="sexy-bikini-1">Bikini Gợi Cảm</option>
                                            <option value="sexy-bikini-2">Bikini Viền</option>
                                            <option value="sexy-bikini-3">Monokini</option>
                                            <option value="sexy-dress-1">Đầm Ôm Sexy</option>
                                            <option value="sexy-dress-2">Đầm Xẻ Đùi</option>
                                            <option value="sexy-dress-3">Đầm Lưới</option>
                                            <option value="sexy-top-1">Crop Top Ngắn</option>
                                            <option value="sexy-top-2">Bra Top</option>
                                            <option value="sexy-top-3">Corset Bustier</option>
                                            <option value="sexy-bottom-1">Quần Lót Cao</option>
                                            <option value="sexy-bottom-2">Quần Short Ngắn</option>
                                            <option value="sexy-bottom-3">Skirt Mini</option>
                                        </optgroup>
                                        <optgroup label="💋 Lingerie">
                                            <option value="lingerie-1">Lingerie Gợi Cảm</option>
                                            <option value="lingerie-2">Babydoll</option>
                                            <option value="lingerie-3">Teddy Bodysuit</option>
                                        </optgroup>
                                        <optgroup label="👗 Váy Dạ Hội">
                                            <option value="evening-gown-1">Váy Dạ Hội</option>
                                            <option value="evening-gown-2">Váy Prom</option>
                                            <option value="evening-gown-3">Váy Gala</option>
                                        </optgroup>
                                        <optgroup label="👕 Thường Ngày">
                                            <option value="casual-1">Áo Thun + Quần</option>
                                            <option value="casual-2">Áo Sơ Mi + Váy</option>
                                            <option value="casual-3">Hoodie + Quần Rộng</option>
                                        </optgroup>
                                        <optgroup label="💼 Công Sở">
                                            <option value="formal-1">Vest Công Sở</option>
                                            <option value="formal-2">Đầm Công Sở</option>
                                            <option value="formal-3">Blazer + Chân Váy</option>
                                        </optgroup>
                                        <optgroup label="🏃 Thể Thao">
                                            <option value="sport-1">Đồ Thể Thao</option>
                                            <option value="sport-2">Yoga Outfit</option>
                                            <option value="sport-3">Bikini Thể Thao</option>
                                        </optgroup>
                                        <optgroup label="❄️ Mùa Đông">
                                            <option value="winter-1">Áo Len Dày</option>
                                            <option value="winter-2">Áo Khoác Lông</option>
                                        </optgroup>
                                    </select>
                                </div>

                                <button
                                    className="btn btn-primary ai-generate-btn"
                                    onClick={handleAIGenerateClothing}
                                    disabled={!selectedAIClothing || isGeneratingClothing}
                                >
                                    {isGeneratingClothing ? '⏳ Đang tạo...' : '✨ Tạo Trang Phục'}
                                </button>
                            </div>

                            {/* AI Generated Clothing Preview */}
                            {aiGeneratedClothing && (
                                <div className="ai-generated-preview">
                                    <h4>🎨 Trang Phục Đã Tạo</h4>
                                    <div className="ai-clothing-result">
                                        <img src={aiGeneratedClothing} alt="AI Generated Clothing" />
                                    </div>
                                    <div className="ai-clothing-actions">
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => applyAIGeneratedClothing('top')}
                                        >
                                            👕 Dùng làm Áo
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => applyAIGeneratedClothing('bottom')}
                                        >
                                            👖 Dùng làm Quần
                                        </button>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => applyAIGeneratedClothing('skirt')}
                                        >
                                            👗 Dùng làm Váy
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Clothing Items Grid */}
                        <div className="clothing-section">
                            <h3 className="subsection-title">👗 Chọn Trang Phục (Tùy chọn)</h3>
                            <p className="section-hint">Tải lên các món đồ bạn muốn thay đổi trên người mẫu</p>

                            <div className="clothing-grid">
                                {/* Fullset / Váy / Đầm - With Reference Images */}
                                <div className="clothing-item fullset-item">
                                    {/* Top: Main Fullset Uploader (70%) */}
                                    <div className="fullset-main">
                                        <ImageUploader
                                            label="👗 Fullset (chính)"
                                            image={skirtImage}
                                            onImageSelect={(e) => handleDirectGarmentUpload(e, 'skirt')}
                                            onRemove={() => handleRemoveGarment('skirt')}
                                        >
                                            <p>Tải ảnh bộ trang phục chính</p>
                                        </ImageUploader>
                                    </div>

                                    {/* Bottom: Reference Images (30%) */}
                                    <div className="fullset-refs">
                                        <label className="ref-label">
                                            📸 Ảnh tham khảo (tối đa 3)
                                        </label>
                                        <div className="ref-images-row">
                                            {refImages.map((refImage, index) => (
                                                <div key={index} className="ref-image-slot">
                                                    {refImage ? (
                                                        <>
                                                            <img src={refImage} alt={`Tham khảo ${index + 1}`} />
                                                            <button
                                                                className="remove-btn"
                                                                onClick={() => handleRemoveRefImage(index)}
                                                                title="Xóa ảnh tham khảo"
                                                            >
                                                                &times;
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <label className="ref-upload-label">
                                                            <span>+</span>
                                                            <input
                                                                type="file"
                                                                accept="image/*"
                                                                onChange={(e) => handleRefImageUpload(e, index)}
                                                                hidden
                                                            />
                                                        </label>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <p className="ref-hint">Ảnh tham khảo từ các góc khác hoặc người mẫu khác</p>
                                    </div>
                                </div>

                                {/* Áo / Top */}
                                <div className="clothing-item">
                                    <ImageUploader
                                        label="👕 Áo / Top"
                                        image={topImage}
                                        onImageSelect={(e) => handleDirectGarmentUpload(e, 'top')}
                                        onRemove={() => handleRemoveGarment('top')}
                                    >
                                        <p>Tải áo/áo phông/áo khoác</p>
                                    </ImageUploader>
                                </div>

                                {/* Quần */}
                                <div className="clothing-item">
                                    <ImageUploader
                                        label="👖 Quần"
                                        image={bottomImage}
                                        onImageSelect={(e) => handleDirectGarmentUpload(e, 'bottom')}
                                        onRemove={() => handleRemoveGarment('bottom')}
                                    >
                                        <p>Tải quần dài/quần short</p>
                                    </ImageUploader>
                                </div>
                            </div>
                        </div>

                        {/* Accessories Section - Collapsible */}
                        <div className="accessories-section">
                            <button
                                className="accessories-toggle"
                                onClick={() => setIsAccessoriesExpanded(!isAccessoriesExpanded)}
                            >
                                <div className="accessories-toggle-left">
                                    <span className="accessories-icon">🎒</span>
                                    <span>Phụ kiện (tùy chọn)</span>
                                    {(shoesImage || jewelryImage || bagImage) && (
                                        <span className="accessories-badge">✓ Đã chọn</span>
                                    )}
                                </div>
                                <span className={`accessories-arrow ${isAccessoriesExpanded ? 'expanded' : ''}`}>
                                    {isAccessoriesExpanded ? '∧' : '∨'}
                                </span>
                            </button>
                            <div className={`accessories-content ${isAccessoriesExpanded ? 'expanded' : ''}`}>
                                <div className="clothing-grid">
                                    <div className="clothing-item">
                                        <ImageUploader
                                            label="👠 Giày / Dép"
                                            image={shoesImage}
                                            onImageSelect={(e) => handleDirectGarmentUpload(e, 'shoes')}
                                            onRemove={() => handleRemoveGarment('shoes')}
                                        >
                                            <p>Tải giày/dép/sandals</p>
                                        </ImageUploader>
                                    </div>

                                    <div className="clothing-item">
                                        <ImageUploader
                                            label="💎 Trang sức"
                                            image={jewelryImage}
                                            onImageSelect={(e) => handleDirectGarmentUpload(e, 'jewelry')}
                                            onRemove={() => handleRemoveGarment('jewelry')}
                                        >
                                            <p>Tải trang sức (vòng cổ, hoa tai...)</p>
                                        </ImageUploader>
                                    </div>

                                    <div className="clothing-item">
                                        <ImageUploader
                                            label="👜 Túi xách"
                                            image={bagImage}
                                            onImageSelect={(e) => handleDirectGarmentUpload(e, 'bag')}
                                            onRemove={() => handleRemoveGarment('bag')}
                                        >
                                            <p>Tải túi xách/túi clutch</p>
                                        </ImageUploader>
                                    </div>
                                </div>
                        </div>
                            </div>

                        {/* Advanced Settings */}
                        <div className="advanced-section compact">
                            <h3 className="subsection-title">⚙️ Cài đặt tạo ảnh</h3>

                            {/* Row 1: Aspect Ratio - Side by side with Transparent */}
                            <div className="settings-row">
                                <div className="setting-group compact">
                                    <label className="setting-label">📐 Tỷ lệ ảnh</label>
                                    <div className="toggle-group">
                                        <button
                                            className={`toggle-btn small ${generationSettings.aspectRatio === '9:16' ? 'active' : ''}`}
                                            onClick={() => setAspectRatio('9:16')}
                                        >
                                            📱 9:16
                                        </button>
                                        <button
                                            className={`toggle-btn small ${generationSettings.aspectRatio === '16:9' ? 'active' : ''}`}
                                            onClick={() => setAspectRatio('16:9')}
                                        >
                                            💻 16:9
                                        </button>
                                    </div>
                                </div>

                                <div className="setting-group compact">
                                    <label className="setting-label">🎨 Nền ảnh</label>
                                    <div className="toggle-group">
                                        <button
                                            className={`toggle-btn small ${!generationSettings.transparentBackground ? 'active' : ''}`}
                                            onClick={() => setGenerationSettings(prev => ({ ...prev, transparentBackground: false }))}
                                        >
                                            🏞️ Nền
                                        </button>
                                        <button
                                            className={`toggle-btn small ${generationSettings.transparentBackground ? 'active' : ''}`}
                                            onClick={() => setGenerationSettings(prev => ({ ...prev, transparentBackground: true }))}
                                        >
                                            💎 Trong suốt
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Row 2: Toggle Options */}
                            <div className="settings-row options-row">
                                <button
                                    className={`option-chip ${generationSettings.changePose ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changePose')}
                                >
                                    {generationSettings.changePose && <span className="chip-check">✓</span>}
                                    <span>💃 Đổi tư thế</span>
                                </button>

                                <button
                                    className={`option-chip ${generationSettings.changeBackground ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changeBackground')}
                                >
                                    {generationSettings.changeBackground && <span className="chip-check">✓</span>}
                                    <span>🏞️ Đổi bối cảnh</span>
                                </button>

                                <button
                                    className={`option-chip ${generationSettings.generateFullBody ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('generateFullBody')}
                                >
                                    {generationSettings.generateFullBody && <span className="chip-check">✓</span>}
                                    <span>🧍 Toàn thân</span>
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Step 2: Hoàn Tất */}
                    <section className="step-card full-width">
                        <h2><span className="step-number">2</span> Hoàn Tất</h2>
                        <div className="finalize-box balanced-layout">
                            <div className="summary-info">
                                <p><strong>Mix & Match</strong> - Upload trực tiếp trang phục</p>

                                <ul className="status-list balanced-list">
                                    <li>Model: {modelFile ? '✅ Sẵn sàng' : '❌ Thiếu'}</li>
                                    <li>Fullset: {skirtImage ? '✅' : '❌ Giữ nguyên'}</li>
                                    <li>Áo: {topImage ? '✅' : '❌ Giữ nguyên'}</li>
                                    <li>Quần: {bottomImage ? '✅' : '❌ Giữ nguyên'}</li>
                                    <li>Giày/Dép: {shoesImage ? '✅' : '❌ Giữ nguyên'}</li>
                                    <li>Trang sức: {jewelryImage ? '✅' : '❌ Giữ nguyên'}</li>
                                    <li>Túi xách: {bagImage ? '✅' : '❌ Giữ nguyên'}</li>
                                </ul>

                                <div className="generation-settings-summary" style={{ fontSize: '0.9rem', color: '#aaa', marginTop: '0.5rem', fontStyle: 'italic' }}>
                                    {generationSettings.aspectRatio === '9:16' ? '📱 Dọc' : '💻 Ngang'} •
                                    {generationSettings.transparentBackground ? ' 💎 Nền trong suốt' : ' 🏞️ Nền thường'} •
                                    {generationSettings.changePose ? ' 💃 Đổi tư thế' : ''}
                                    {generationSettings.changeBackground ? ' 🏞️ Đổi nền' : ''}
                                    {generationSettings.generateFullBody ? ' 🧍 Toàn thân' : ''}
                                </div>
                            </div>

                            <button
                                className="btn btn-primary start-btn"
                                onClick={handleGenerateTryOn}
                                disabled={
                                    isGenerating ||
                                    !modelFile
                                }
                            >
                                ✨ {isGenerating ? 'Đang mặc đồ...' : 'Bắt đầu ghép đồ'}
                            </button>
                        </div>
                    </section>
                </main>
            )}

            {activeTab === 'skin-fix' && (
                <main className="workflow-container">
                    <section className="step-card full-width">
                        <h2>✨ AI Phục Hồi Vật Lý Da (Plasticity Removal)</h2>
                        <p className="section-desc">
                            Công nghệ Semantic Texture Synthesis giúp khôi phục độ chân thực vật lý cho da.
                            AI sẽ tái tạo lỗ chân lông, xử lý lại ánh sáng (Subsurface Scattering) và loại bỏ hiệu ứng "bóng sáp"
                            mà vẫn <strong>giữ nguyên danh tính và biểu cảm gốc</strong> (Identity Preservation).
                        </p>

                        {/* Auto-fix notification */}
                        {autoFixFromUrl && !skinResult && (
                            <div className="auto-fix-notification">
                                <div className="spinner"></div>
                                <span>🔄 Đang tự động xử lý ảnh từ Virtual Try-On...</span>
                            </div>
                        )}

                        {/* Upload Section - Side by Side - ALIGNED */}
                        <div className="side-by-side-container">
                            <div className="side-by-side-item">
                                <h4 className="side-by-side-label">Hình Gốc</h4>
                                <ImageUploader
                                    image={skinPreview}
                                    onImageSelect={(e) => handleFileChange(e, setSkinFile, setSkinPreview)}
                                    onRemove={() => { setSkinFile(null); setSkinPreview(null); } }
                                >
                                    <p className="upload-hint">+ Tải ảnh cần xử lý</p>
                                </ImageUploader>
                            </div>

                            <div className="side-by-side-item">
                                <h4 className="side-by-side-label">Trước / Sau</h4>
                                <BeforeAfterSlider
                                    beforeSrc={skinPreview}
                                    afterSrc={skinResult}
                                    beforeAlt="Skin before"
                                    afterAlt="Skin after"
                                    isLoading={isFixingSkin}
                                    loadingText="Đang phân tích & tái tạo da..."
                                />
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="action-section">
                            <button
                                className="btn btn-primary"
                                onClick={() => handleFixSkin()}
                                disabled={!skinFile || isFixingSkin}
                                style={{ padding: '16px 32px', fontSize: '1.1rem', maxWidth: '300px' }}
                            >
                                {isFixingSkin ? '🧬 Đang xử lý...' : '🚀 Khôi Phục Da'}
                            </button>
                        </div>
                    </section>
                </main>
            )}

            {activeTab === 'breast-aug' && (
                <main className="workflow-container">
                    <section className="step-card full-width">
                        <h2>AI Nâng Ngực To Và Căng Tự Nhiên</h2>
                        <p className="section-desc">
                            Tải ảnh nhân vật lên và AI sẽ làm cho nhân vật có bộ ngực to và căng tự nhiên.
                            Hệ thống sẽ tự động điều chỉnh trang phục và ánh sáng để đảm bảo độ chân thực nhất.
                        </p>

                        {/* Auto-aug notification */}
                        {autoAugFromUrl && !breastAugResult && (
                            <div className="auto-fix-notification" style={{ background: 'linear-gradient(135deg, #ff5252, #d32f2f)' }}>
                                <div className="spinner"></div>
                                <span>🔄 Đang tự động nâng ngực từ ảnh...</span>
                            </div>
                        )}

                        {/* Upload Section - Side by Side - ALIGNED */}
                        <div className="side-by-side-container">
                            <div className="side-by-side-item">
                                <h4 className="side-by-side-label">Hình Gốc</h4>
                                <ImageUploader
                                    image={breastAugPreview}
                                    onImageSelect={(e) => handleFileChange(e, setBreastAugFile, setBreastAugPreview)}
                                    onRemove={() => { setBreastAugFile(null); setBreastAugPreview(null); } }
                                >
                                    <p className="upload-hint">+ Tải ảnh nhân vật</p>
                                </ImageUploader>
                            </div>

                            <div className="side-by-side-item">
                                <h4 className="side-by-side-label">Trước / Sau</h4>
                                <BeforeAfterSlider
                                    beforeSrc={breastAugPreview}
                                    afterSrc={breastAugResult}
                                    beforeAlt="Breast before"
                                    afterAlt="Breast after"
                                    isLoading={isBreastAugmenting}
                                    loadingText="Đang nâng cấp vòng 1..."
                                />
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="action-section">
                            <button
                                className="btn btn-primary"
                                onClick={() => handleBreastAugmentation()}
                                disabled={!breastAugFile || isBreastAugmenting}
                                style={{ padding: '16px 32px', fontSize: '1.1rem', maxWidth: '300px', background: 'linear-gradient(135deg, #ff5252, #d32f2f)' }}
                            >
                                {isBreastAugmenting ? '🍑 Đang xử lý...' : '🚀 Nâng Ngực'}
                            </button>
                        </div>
                    </section>
                </main>
            )}

            {/* Result Display for Try-On */}
            {activeTab === 'try-on' && (isGenerating || finalImage) && (
                <section className="result-card">
                    <h2>Kết Quả Virtual Try-On</h2>
                    <div className="image-container">
                        {isGenerating && (
                            <div className="loader-container">
                                <div className="spinner"></div>
                                <p>AI đang phối đồ và xử lý ánh sáng...</p>
                            </div>
                        )}
                        {finalImage && <img src={finalImage} alt="Final result" />}
                    </div>
                    {finalImage && (
                        <div className="action-buttons">
                            <button
                                className="btn btn-secondary"
                                onClick={() => handleDownload(finalImage, 'try-on', '4k')}
                            >
                                💾 Tải ảnh PNG (4K)
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => handleAutoFixSkin(finalImage)}
                            >
                                ✨ Fix Da Nhựa
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={async () => {
                                    if (finalImage) {
                                        const file = await dataUrlToFile(finalImage, 'try-on-bg-change.png');
                                        if (file) {
                                            setBgSourceFile(file);
                                            setBgSourcePreview(finalImage);
                                            handleTabChange('change-background');
                                        }
                                    }
                                }}
                                style={{ background: 'linear-gradient(135deg, #ff9800, #f57c00)' }}
                            >
                                🏞️ Đổi bối cảnh
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* Result Display for Skin Fix */}
            {activeTab === 'skin-fix' && (isFixingSkin || skinResult) && (
                <section className="result-card">
                    <h2>✨ Kết Quả Khôi Phục (Realism)</h2>

                    {/* Side by Side Result Comparison */}
                    <div className="side-by-side-container">
                        <div className="side-by-side-item">
                            <h4 className="side-by-side-label">📷 Trước</h4>
                            <div className="result-display">
                                {isFixingSkin ? (
                                    <div className="loader-container">
                                        <div className="spinner"></div>
                                        <p>Đang tái tạo texture vi mô & ánh sáng...</p>
                                    </div>
                                ) : (
                                    <MagnifierImage
                                        src={skinPreview || skinResult || ''}
                                        alt="Original"
                                        zoomLevel={2}
                                        containerClass="result-magnifier"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="side-by-side-item">
                            <h4 className="side-by-side-label">✨ Sau</h4>
                            <div className="result-display">
                                {isFixingSkin ? (
                                    <div className="loader-container">
                                        <div className="spinner"></div>
                                        <p>Đang tái tạo texture vi mô & ánh sáng...</p>
                                    </div>
                                ) : skinResult ? (
                                    <MagnifierImage
                                        src={skinResult}
                                        alt="Skin fix result"
                                        zoomLevel={2}
                                        containerClass="result-magnifier"
                                    />
                                ) : (
                                    <div className="placeholder-text">
                                        <span className="placeholder-icon">🖼️</span>
                                        <p>Chưa có kết quả</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    {skinResult && (
                        <div className="action-buttons">
                            <button
                                className="btn btn-secondary"
                                onClick={() => handleDownload(skinResult, 'skin-fix', '4k')}
                            >
                                💾 Tải ảnh PNG (4K)
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => handleAutoBreastAug(skinResult)}
                                style={{ background: 'linear-gradient(135deg, #ff5252, #d32f2f)' }}
                            >
                                🍑 Tiếp tục: Nâng Ngực
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* Result Display for Breast Augmentation */}
            {activeTab === 'breast-aug' && (isBreastAugmenting || breastAugResult) && (
                <section className="result-card">
                    <h2>🍑 Kết Quả Nâng Ngực</h2>

                    {/* Side by Side Result Comparison */}
                    <div className="side-by-side-container">
                        <div className="side-by-side-item">
                            <h4 className="side-by-side-label">📷 Trước</h4>
                            <div className="result-display">
                                {isBreastAugmenting ? (
                                    <div className="loader-container">
                                        <div className="spinner"></div>
                                        <p>Đang xử lý hình thể và trang phục...</p>
                                    </div>
                                ) : (
                                    <MagnifierImage
                                        src={breastAugPreview || breastAugResult || ''}
                                        alt="Original"
                                        zoomLevel={2}
                                        containerClass="result-magnifier"
                                    />
                                )}
                            </div>
                        </div>
                        <div className="side-by-side-item">
                            <h4 className="side-by-side-label">✨ Sau</h4>
                            <div className="result-display">
                                {isBreastAugmenting ? (
                                    <div className="loader-container">
                                        <div className="spinner"></div>
                                        <p>Đang xử lý hình thể và trang phục...</p>
                                    </div>
                                ) : breastAugResult ? (
                                    <MagnifierImage
                                        src={breastAugResult}
                                        alt="Breast Augmentation result"
                                        zoomLevel={2}
                                        containerClass="result-magnifier"
                                    />
                                ) : (
                                    <div className="placeholder-text">
                                        <span className="placeholder-icon">🖼️</span>
                                        <p>Chưa có kết quả</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Download & Continue Button */}
                    {breastAugResult && (
                        <>
                            <div className="action-buttons" style={{ justifyContent: 'center' }}>
                                <button
                                    onClick={() => handleDownload(breastAugResult, 'breast-aug', '4k')}
                                    className="btn btn-secondary"
                                    style={{ minWidth: '200px' }}
                                >
                                    💾 Tải ảnh PNG (4K)
                                </button>
                            </div>
                            <div className="continue-aug-container" style={{ marginTop: '1rem' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleContinueAugmentation}
                                    disabled={isBreastAugmenting}
                                    style={{
                                        minWidth: '200px',
                                        background: 'linear-gradient(135deg, #ff5252, #d32f2f)',
                                        padding: '14px 28px',
                                        fontSize: '1rem'
                                    }}
                                >
                                    {isBreastAugmenting ? '🍑 Đang nâng tiếp...' : '🍑 Nâng Tiếp'}
                                </button>
                                <p style={{ marginTop: '8px', fontSize: '0.85rem', color: '#888' }}>
                                    Sử dụng kết quả hiện tại để nâng thêm một lần nữa
                                </p>
                            </div>
                        </>
                    )}
                </section>
            )}

            {/* Result Display for Face Swap */}
            {activeTab === 'swap-face' && (
                <main className="workflow-container">
                    <section className="step-card full-width">
                        <h2>🔄 Face Swap - Đổi Khuôn Mặt</h2>
                        <p className="section-desc">
                            Upload ảnh nhân vật chính và ảnh khuôn mặt để AI đổi khuôn mặt.
                            Hỗ trợ thay đổi tư thế, biểu cảm, bối cảnh và nền trong suốt.
                        </p>

                        {/* Source and Target Images */}
                        <div className="dual-upload-container">
                            <div className="upload-column">
                                <h4>🧑 Nhân vật chính</h4>
                                <ImageUploader
                                    image={modelPreview}
                                    onImageSelect={(e) => handleFileChange(e, setModelFile, setModelPreview)}
                                    onRemove={() => { setModelFile(null); setModelPreview(null); }}
                                >
                                    <p className="upload-hint">+ Tải ảnh nhân vật cần đổi mặt</p>
                                </ImageUploader>
                            </div>

                            <div className="upload-column">
                                <h4>😊 Khuôn mặt nguồn</h4>
                                <ImageUploader
                                    image={faceSourcePreview}
                                    onImageSelect={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            setFaceSourceFile(file);
                                            setFaceSourcePreview(URL.createObjectURL(file));
                                        }
                                    }}
                                    onRemove={() => { setFaceSourceFile(null); setFaceSourcePreview(null); }}
                                >
                                    <p className="upload-hint">+ Tải ảnh khuôn mặt thay thế</p>
                                </ImageUploader>
                                <p className="upload-directive" style={{ marginTop: '8px', fontSize: '0.8rem', color: '#888', fontStyle: 'italic' }}>
                                    💡 Hướng dẫn: Upload ảnh có khuôn mặt rõ ràng, mắt mở, không đeo kính râm, ánh sáng tốt để AI trích xuất chính xác đặc điểm khuôn mặt
                                </p>
                            </div>
                        </div>

                        {/* Hot Swap Button */}
                        {modelPreview && faceSourcePreview && (
                            <div className="hot-swap-section">
                                <button
                                    className={`hot-swap-btn ${isHotSwap ? 'swapped' : ''}`}
                                    onClick={() => {
                                        // Swap files
                                        const tempFile = modelFile;
                                        setModelFile(faceSourceFile);
                                        setFaceSourceFile(tempFile);

                                        // Swap previews
                                        const tempPreview = modelPreview;
                                        setModelPreview(faceSourcePreview);
                                        setFaceSourcePreview(tempPreview);

                                        // Toggle hot-swap state
                                        setIsHotSwap(!isHotSwap);
                                    }}
                                    title="Hoán đổi vị trí ảnh gốc và ảnh khuôn mặt"
                                >
                                    <span className="hot-swap-icon">🔄</span>
                                    Hot-Swap
                                    <span className="hot-swap-status">
                                        {isHotSwap ? '(Đã hoán đổi)' : ''}
                                    </span>
                                </button>
                            </div>
                        )}

                        {/* Advanced Settings for Face Swap */}
                        <div className="advanced-section compact" style={{ marginTop: '1.5rem' }}>
                            <h3 className="subsection-title">⚙️ Cài đặt tạo ảnh</h3>

                            <div className="settings-row">
                                <div className="setting-group compact">
                                    <label className="setting-label">📐 Tỷ lệ ảnh</label>
                                    <div className="toggle-group">
                                        <button
                                            className={`toggle-btn small ${generationSettings.aspectRatio === '9:16' ? 'active' : ''}`}
                                            onClick={() => setAspectRatio('9:16')}
                                        >
                                            📱 9:16
                                        </button>
                                        <button
                                            className={`toggle-btn small ${generationSettings.aspectRatio === '16:9' ? 'active' : ''}`}
                                            onClick={() => setAspectRatio('16:9')}
                                        >
                                            💻 16:9
                                        </button>
                                    </div>
                                </div>

                                <div className="setting-group compact">
                                    <label className="setting-label">🎨 Nền ảnh</label>
                                    <div className="toggle-group">
                                        <button
                                            className={`toggle-btn small ${!generationSettings.transparentBackground ? 'active' : ''}`}
                                            onClick={() => setGenerationSettings(prev => ({ ...prev, transparentBackground: false }))}
                                        >
                                            🏞️ Nền
                                        </button>
                                        <button
                                            className={`toggle-btn small ${generationSettings.transparentBackground ? 'active' : ''}`}
                                            onClick={() => setGenerationSettings(prev => ({ ...prev, transparentBackground: true }))}
                                        >
                                            💎 Trong suốt
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-row options-row">
                                <button
                                    className={`option-chip ${generationSettings.changePose ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changePose')}
                                >
                                    {generationSettings.changePose && <span className="chip-check">✓</span>}
                                    <span>💃 Đổi tư thế</span>
                                </button>

                                <button
                                    className={`option-chip ${generationSettings.changeExpression ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changeExpression')}
                                >
                                    {generationSettings.changeExpression && <span className="chip-check">✓</span>}
                                    <span>😊 Đổi biểu cảm</span>
                                </button>

                                <button
                                    className={`option-chip ${generationSettings.changeBackground ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changeBackground')}
                                >
                                    {generationSettings.changeBackground && <span className="chip-check">✓</span>}
                                    <span>🏞️ Đổi bối cảnh</span>
                                </button>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="action-section" style={{ marginTop: '1.5rem' }}>
                            <button
                                className="btn btn-primary"
                                onClick={handleFaceSwap}
                                disabled={!modelFile || !faceSourceFile || isSwapping}
                                style={{
                                    padding: '16px 32px',
                                    fontSize: '1.1rem',
                                    background: 'linear-gradient(135deg, #bb86fc, #03dac6)'
                                }}
                            >
                                {isSwapping ? '🔄 Đang xử lý...' : '🚀 Thực Hiện Face Swap'}
                            </button>
                        </div>
                    </section>

                    {/* Result Display - Full Width */}
                    {(isSwapping || swapResult) && (
                        <section className="result-card full-width">
                            <h2>🔄 Kết Quả Face Swap</h2>

                            {/* Before-After Slider */}
                            <div className="side-by-side-container">
                                <div className="side-by-side-item">
                                    <h4 className="side-by-side-label">Trước / Sau</h4>
                                    <BeforeAfterSlider
                                        beforeSrc={isHotSwap ? faceSourcePreview : modelPreview}
                                        afterSrc={swapResult}
                                        beforeAlt="Khuôn mặt gốc"
                                        afterAlt="Kết quả Face Swap"
                                        isLoading={isSwapping}
                                        loadingText="Đang xử lý Face Swap..."
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="action-buttons" style={{ justifyContent: 'center', marginTop: '1.5rem' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => handleDownload(swapResult, 'face-swap', '4k')}
                                >
                                    💾 Tải ảnh PNG (4K)
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        if (swapResult) {
                                            // Convert data URL to File and set to try-on model
                                            const file = await dataUrlToFile(swapResult, 'face-swap-tryon.png');
                                            if (file) {
                                                setModelFile(file);
                                                setModelPreview(swapResult);
                                                // Clear other try-on images to avoid confusion
                                                setTopImage(null);
                                                setBottomImage(null);
                                                setSkirtImage(null);
                                                setShoesImage(null);
                                                setJewelryImage(null);
                                                setBagImage(null);
                                                setRefImages([null, null, null]);
                                                // Switch to try-on tab
                                                handleTabChange('try-on');
                                            }
                                        }
                                    }}
                                    style={{ background: 'linear-gradient(135deg, #4caf50, #2e7d32)' }}
                                >
                                    📤 Nạp vào Try-on
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        if (swapResult) {
                                            handleAutoFixSkin(swapResult);
                                        }
                                    }}
                                >
                                    ✨ Fix da nhựa
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        if (swapResult) {
                                            handleAutoBreastAug(swapResult);
                                        }
                                    }}
                                >
                                    👙 Nâng ngực
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        if (swapResult) {
                                            const file = await dataUrlToFile(swapResult, 'face-swap-bg-change.png');
                                            if (file) {
                                                setBgSourceFile(file);
                                                setBgSourcePreview(swapResult);
                                                handleTabChange('change-background');
                                            }
                                        }
                                    }}
                                    style={{ background: 'linear-gradient(135deg, #ff9800, #f57c00)' }}
                                >
                                    🏞️ Đổi bối cảnh
                                </button>
                            </div>
                        </section>
                    )}
                </main>
            )}

            {/* Change Background */}
            {activeTab === 'change-background' && (
                <main className="workflow-container">
                    <section className="step-card full-width">
                        <h2>🏞️ Thay Đổi Bối Cảnh</h2>
                        <p className="section-desc">
                            Tải ảnh người mẫu lên và đặt vào bối cảnh mới. Bạn có thể tải ảnh nền riêng hoặc chọn từ 20 môi trường có sẵn.
                        </p>

                        {/* Source and Background Images */}
                        <div className="dual-upload-container">
                            <div className="upload-column">
                                <h4>📷 Ảnh Người Mẫu</h4>
                                <ImageUploader
                                    image={bgSourcePreview}
                                    onImageSelect={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            setBgSourceFile(file);
                                            setBgSourcePreview(URL.createObjectURL(file));
                                        }
                                    }}
                                    onRemove={() => { setBgSourceFile(null); setBgSourcePreview(null); }}
                                >
                                    <p className="upload-hint">+ Tải ảnh người mẫu</p>
                                </ImageUploader>
                            </div>

                            <div className="upload-column">
                                <h4>🖼️ Ảnh Nền (Tùy chọn)</h4>
                                <ImageUploader
                                    image={customBgPreview}
                                    onImageSelect={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                            setCustomBgFile(file);
                                            setCustomBgPreview(URL.createObjectURL(file));
                                            setSelectedBackground(null);
                                        }
                                    }}
                                    onRemove={() => { setCustomBgFile(null); setCustomBgPreview(null); }}
                                >
                                    <p className="upload-hint">+ Tải ảnh nền riêng</p>
                                </ImageUploader>
                                {!customBgPreview && (
                                    <p className="upload-hint" style={{ marginTop: '8px', fontSize: '0.85rem', color: '#888' }}>
                                        Hoặc chọn bối cảnh bên dưới
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Background Preset Selector */}
                        {!customBgPreview && (
                            <div className="background-selector-section" style={{ marginTop: '1.5rem' }}>
                                <h3 className="subsection-title">🎨 Chọn Bối Cảnh (55 môi trường)</h3>
                                
                                <div className="background-grid">
                                    {/* Random option */}
                                    <button
                                        className={`bg-preset-btn random-bg ${selectedBackground === 'random' ? 'selected' : ''}`}
                                        onClick={() => { setSelectedBackground('random'); setCustomBgFile(null); setCustomBgPreview(null); }}
                                    >
                                        <span className="bg-preset-icon">🎲</span>
                                        <span className="bg-preset-name">Ngẫu nhiên</span>
                                        <span className="bg-preset-desc">AI tự chọn</span>
                                    </button>

                                    {/* Transparent option */}
                                    <button
                                        className={`bg-preset-btn ${selectedBackground === 'transparent' ? 'selected' : ''}`}
                                        onClick={() => { setSelectedBackground('transparent'); setCustomBgFile(null); setCustomBgPreview(null); }}
                                    >
                                        <span className="bg-preset-icon">💎</span>
                                        <span className="bg-preset-name">Trong suốt</span>
                                        <span className="bg-preset-desc">Xóa nền</span>
                                    </button>

                                    {/* All presets */}
                                    {backgroundPresets.filter(bg => bg.id !== 'transparent').map((bg) => (
                                        <button
                                            key={bg.id}
                                            className={`bg-preset-btn ${selectedBackground === bg.id ? 'selected' : ''}`}
                                            onClick={() => { setSelectedBackground(bg.id); setCustomBgFile(null); setCustomBgPreview(null); }}
                                        >
                                            <span className="bg-preset-icon">{bg.icon}</span>
                                            <span className="bg-preset-name">{bg.name}</span>
                                            <span className="bg-preset-desc">{bg.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Selected background indicator */}
                        {(customBgPreview || selectedBackground) && (
                            <div className="selected-bg-indicator" style={{ marginTop: '1rem', padding: '1rem', background: '#2a2a2a', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', border: '1px solid #444' }}>
                                <span style={{ fontSize: '1.5rem' }}>
                                    {customBgPreview ? '🖼️' : (selectedBackground === 'random' ? '🎲' : backgroundPresets.find(b => b.id === selectedBackground)?.icon)}
                                </span>
                                <strong style={{ color: '#fff', fontSize: '1rem' }}>
                                    {customBgPreview ? 'Nền tùy chỉnh' : (selectedBackground === 'random' ? 'Chế độ ngẫu nhiên' : backgroundPresets.find(b => b.id === selectedBackground)?.name)}
                                </strong>
                                <button 
                                    className="btn btn-small btn-secondary" 
                                    style={{ marginLeft: 'auto' }}
                                    onClick={() => { setCustomBgFile(null); setCustomBgPreview(null); setSelectedBackground(null); }}
                                >
                                    Thay đổi
                                </button>
                            </div>
                        )}

                        {/* Advanced Settings */}
                        <div className="advanced-section compact" style={{ marginTop: '1.5rem' }}>
                            <h3 className="subsection-title">⚙️ Cài đặt tạo ảnh</h3>

                            <div className="settings-row">
                                <div className="setting-group compact">
                                    <label className="setting-label">📐 Tỷ lệ ảnh</label>
                                    <div className="toggle-group">
                                        <button
                                            className={`toggle-btn small ${generationSettings.aspectRatio === '9:16' ? 'active' : ''}`}
                                            onClick={() => setAspectRatio('9:16')}
                                        >
                                            📱 9:16
                                        </button>
                                        <button
                                            className={`toggle-btn small ${generationSettings.aspectRatio === '16:9' ? 'active' : ''}`}
                                            onClick={() => setAspectRatio('16:9')}
                                        >
                                            💻 16:9
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-row options-row">
                                <button
                                    className={`option-chip ${generationSettings.changePose ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changePose')}
                                >
                                    {generationSettings.changePose && <span className="chip-check">✓</span>}
                                    <span>💃 Đổi tư thế</span>
                                </button>

                                <button
                                    className={`option-chip ${generationSettings.changeExpression ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('changeExpression')}
                                >
                                    {generationSettings.changeExpression && <span className="chip-check">✓</span>}
                                    <span>😊 Đổi biểu cảm</span>
                                </button>

                                <button
                                    className={`option-chip ${generationSettings.generateFullBody ? 'active' : ''}`}
                                    onClick={() => toggleGenerationSetting('generateFullBody')}
                                >
                                    {generationSettings.generateFullBody && <span className="chip-check">✓</span>}
                                    <span>🦵 Toàn thân</span>
                                </button>
                            </div>
                        </div>

                        {/* Action Button */}
                        <div className="action-section" style={{ marginTop: '1.5rem' }}>
                            <button
                                className="btn btn-primary"
                                onClick={handleChangeBackground}
                                disabled={!bgSourceFile || (!customBgFile && !selectedBackground) || isChangingBg}
                                style={{
                                    padding: '16px 32px',
                                    fontSize: '1.1rem',
                                    background: 'linear-gradient(135deg, #bb86fc, #03dac6)'
                                }}
                            >
                                {isChangingBg ? '🔄 Đang xử lý...' : '🚀 Thay Đổi Bối Cảnh'}
                            </button>
                        </div>
                    </section>

                    {/* Result Display - Full Width */}
                    {(isChangingBg || bgResult) && (
                        <section className="result-card full-width">
                            <h2>🏞️ Kết Quả Thay Đổi Bối Cảnh</h2>

                            {/* Before-After Slider */}
                            <div className="side-by-side-container">
                                <div className="side-by-side-item">
                                    <h4 className="side-by-side-label">Trước / Sau</h4>
                                    <BeforeAfterSlider
                                        beforeSrc={bgSourcePreview}
                                        afterSrc={bgResult}
                                        beforeAlt="Ảnh gốc"
                                        afterAlt="Kết quả thay đổi bối cảnh"
                                        isLoading={isChangingBg}
                                        loadingText="Đang xử lý thay đổi bối cảnh..."
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="action-buttons" style={{ justifyContent: 'center', marginTop: '1.5rem' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => handleDownload(bgResult, 'change-background', '4k')}
                                >
                                    💾 Tải ảnh PNG (4K)
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={async () => {
                                        if (bgResult) {
                                            const file = await dataUrlToFile(bgResult, 'bg-changed-tryon.png');
                                            if (file) {
                                                setModelFile(file);
                                                setModelPreview(bgResult);
                                                setActiveTab('try-on');
                                            }
                                        }
                                    }}
                                >
                                    📤 Nạp vào Try-on
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        if (bgResult) {
                                            handleAutoFixSkin(bgResult);
                                        }
                                    }}
                                >
                                    ✨ Fix Da Nhựa
                                </button>
                            </div>
                        </section>
                    )}
                </main>
            )}

            {/* AI Influencer Creator */}
            {activeTab === 'ai-influencer' && (
                <main className="workflow-container">
                    <section className="step-card full-width">
                        <h2>👤 Tạo AI Influencer</h2>
                        <p className="section-desc">
                            Tạo KOL ảo với các tùy chỉnh chi tiết về ngoại hình, phong cách và bối cảnh.
                        </p>

                        {/* Influencer Attributes */}
                        <div className="influencer-builder">
                            {/* Row 1: Gender & Age & Ethnicity */}
                            <div className="influencer-row">
                                <div className="influencer-group">
                                    <label className="influencer-label">👫 Giới tính</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerGender}
                                        onChange={(e) => setInfluencerGender(e.target.value)}
                                    >
                                        <option value="Female">Nữ (Female)</option>
                                        <option value="Male">Nam (Male)</option>
                                        <option value="Non-binary">Phi nhị nguyên (Non-binary)</option>
                                        <option value="Androgynous">Trung tính (Androgynous)</option>
                                    </select>
                                </div>

                                <div className="influencer-group">
                                    <label className="influencer-label">🎂 Độ tuổi</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerAge}
                                        onChange={(e) => setInfluencerAge(e.target.value)}
                                    >
                                        <option value="18-20">18-20 (Teen/Young adult)</option>
                                        <option value="20s">20s (Trẻ)</option>
                                        <option value="30s">30s (Trưởng thành)</option>
                                        <option value="40s">40s (Chững chạc)</option>
                                    </select>
                                </div>

                                <div className="influencer-group">
                                    <label className="influencer-label">🌍 Miền (Việt Nam)</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerEthnicity}
                                        onChange={(e) => setInfluencerEthnicity(e.target.value)}
                                    >
                                        <option value="Việt Nam - Miền Bắc">Việt Nam - Miền Bắc</option>
                                        <option value="Việt Nam - Miền Trung">Việt Nam - Miền Trung</option>
                                        <option value="Việt Nam - Miền Nam">Việt Nam - Miền Nam</option>
                                    </select>
                                </div>

                                <div className="influencer-group">
                                    <label className="influencer-label">🎨 Màu da</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerSkinTone}
                                        onChange={(e) => setInfluencerSkinTone(e.target.value)}
                                    >
                                        <option value="Very Fair (Porcelain)">Rất trắng (Porcelain)</option>
                                        <option value="Fair (Light)">Trắng (Light)</option>
                                        <option value="Medium (Nude)">Ngà (Medium)</option>
                                        <option value="Tan">Tan</option>
                                        <option value="Medium Brown">Nâu trung bình</option>
                                        <option value="Dark Brown">Nâu đậm</option>
                                        <option value="Deep (Espresso)">Rất đậm (Espresso)</option>
                                    </select>
                                </div>
                            </div>

                            {/* Row 2: Hair Options */}
                            <div className="influencer-section">
                                <h3 className="influencer-section-title">💇 Tóc</h3>
                                <div className="influencer-row four-cols">
                                    <div className="influencer-group">
                                        <label className="influencer-sub-label">Độ dài</label>
                                        <select
                                            className="influencer-select"
                                            value={influencerHairLength}
                                            onChange={(e) => setInfluencerHairLength(e.target.value)}
                                        >
                                            <option value="Long">Dài (Long)</option>
                                            <option value="Shoulder-length">Ngang vai (Shoulder)</option>
                                            <option value="Short bob">Ngắn bob (Short bob)</option>
                                            <option value="Pixie cut">Pixie (Pixie cut)</option>
                                        </select>
                                    </div>

                                    <div className="influencer-group">
                                        <label className="influencer-sub-label">Màu tóc</label>
                                        <select
                                            className="influencer-select"
                                            value={influencerHairColor}
                                            onChange={(e) => setInfluencerHairColor(e.target.value)}
                                        >
                                            <option value="Natural black">Đen tự nhiên</option>
                                            <option value="Chocolate brown">Nâu chocolate</option>
                                            <option value="Chestnut brown">Nâu hạt dẻ</option>
                                            <option value="Ash brown">Nâu khói</option>
                                            <option value="Honey blonde">Vàng mật ong</option>
                                            <option value="Platinum blonde">Vàng bạch kim</option>
                                            <option value="Burgundy">Đỏ rượu</option>
                                            <option value="Smoky gray">Xám khói</option>
                                        </select>
                                    </div>

                                    <div className="influencer-group">
                                        <label className="influencer-sub-label">Chất tóc</label>
                                        <select
                                            className="influencer-select"
                                            value={influencerHairTexture}
                                            onChange={(e) => setInfluencerHairTexture(e.target.value)}
                                        >
                                            <option value="Straight silky">Thẳng mượt</option>
                                            <option value="Soft wavy">Gợn sóng nhẹ</option>
                                            <option value="Loose curls">Xoăn lơi</option>
                                            <option value="Tight curls">Xoăn tít</option>
                                        </select>
                                    </div>

                                    <div className="influencer-group">
                                        <label className="influencer-sub-label">Mái tóc</label>
                                        <select
                                            className="influencer-select"
                                            value={influencerHairBangs}
                                            onChange={(e) => setInfluencerHairBangs(e.target.value)}
                                        >
                                            <option value="Airy bangs">Mái thưa Hàn</option>
                                            <option value="Blunt bangs">Mái bằng</option>
                                            <option value="Curtain bangs">Mái bay</option>
                                            <option value="No bangs">Không mái</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Hair Presets */}
                                <div className="influencer-presets">
                                    <button className="preset-chip" onClick={() => {
                                        setInfluencerHairLength('Long');
                                        setInfluencerHairColor('Natural black');
                                        setInfluencerHairTexture('Straight silky');
                                        setInfluencerHairBangs('Airy bangs');
                                    }}>
                                        ✨ Dài đen thẳng + Mái thưa
                                    </button>
                                    <button className="preset-chip" onClick={() => {
                                        setInfluencerHairLength('Long');
                                        setInfluencerHairColor('Chocolate brown');
                                        setInfluencerHairTexture('Soft wavy');
                                        setInfluencerHairBangs('Curtain bangs');
                                    }}>
                                        ✨ Dài nâu + Mái bay
                                    </button>
                                    <button className="preset-chip" onClick={() => {
                                        setInfluencerHairLength('Short bob');
                                        setInfluencerHairColor('Natural black');
                                        setInfluencerHairTexture('Straight silky');
                                        setInfluencerHairBangs('No bangs');
                                    }}>
                                        ✨ Bob ngắn đen + Không mái
                                    </button>
                                    <button className="preset-chip" onClick={() => {
                                        setInfluencerHairLength('Shoulder-length');
                                        setInfluencerHairColor('Ash brown');
                                        setInfluencerHairTexture('Soft wavy');
                                        setInfluencerHairBangs('Airy bangs');
                                    }}>
                                        ✨ Ngang vai nâu khói + Mái thưa
                                    </button>
                                    <button className="preset-chip" onClick={() => {
                                        setInfluencerHairLength('Long');
                                        setInfluencerHairColor('Honey blonde');
                                        setInfluencerHairTexture('Loose curls');
                                        setInfluencerHairBangs('Curtain bangs');
                                    }}>
                                        ✨ Dài vàng + Xoăn lơi + Mái bay
                                    </button>
                                </div>
                            </div>

                            {/* Row 3: Eyes & Body & Style */}
                            <div className="influencer-row">
                                <div className="influencer-group">
                                    <label className="influencer-label">👁️ Màu mắt</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerEyeColor}
                                        onChange={(e) => setInfluencerEyeColor(e.target.value)}
                                    >
                                        <option value="Brown">Nâu (Brown)</option>
                                        <option value="Dark brown">Nâu đậm (Dark brown)</option>
                                        <option value="Amber">Hổ phách (Amber)</option>
                                        <option value="Green">Xanh lá (Green)</option>
                                        <option value="Blue">Xanh dương (Blue)</option>
                                        <option value="Gray">Xám (Gray)</option>
                                    </select>
                                </div>

                                <div className="influencer-group">
                                    <label className="influencer-label">💪 Dáng người</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerBody}
                                        onChange={(e) => setInfluencerBody(e.target.value)}
                                    >
                                        <option value="Slim & fit">Mảnh & fit</option>
                                        <option value="Slim">Mảnh</option>
                                        <option value="Balanced">Cân đối</option>
                                        <option value="Athletic">Thể thao</option>
                                        <option value="Curvy">Đường cong</option>
                                        <option value="Tall & slim">Cao & mảnh</option>
                                        <option value="Petite">Nhỏ nhắn</option>
                                    </select>
                                </div>

                                <div className="influencer-group">
                                    <label className="influencer-label">👗 Phong cách</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerStyle}
                                        onChange={(e) => setInfluencerStyle(e.target.value)}
                                    >
                                        <option value="Cute casual">Cute casual (Dễ thương)</option>
                                        <option value="Modern luxury">Modern luxury (Sang)</option>
                                        <option value="Minimalist">Minimalist (Tối giản)</option>
                                        <option value="Korean chic">Korean chic (Hàn Quốc)</option>
                                        <option value="Streetwear">Streetwear (Đường phố)</option>
                                        <option value="Preppy">Preppy (Học đường)</option>
                                        <option value="Office core">Office core (Đi làm)</option>
                                        <option value="Vintage">Vintage (Cổ điển)</option>
                                        <option value="Y2K">Y2K (Gen Z)</option>
                                        <option value="Coquette">Coquette / Balletcore</option>
                                    </select>
                                </div>

                                <div className="influencer-group">
                                    <label className="influencer-label">🎬 Bối cảnh / Hoạt động</label>
                                    <select
                                        className="influencer-select"
                                        value={influencerScenario}
                                        onChange={(e) => setInfluencerScenario(e.target.value)}
                                    >
                                        <optgroup label="☕ Cafe & Lifestyle">
                                            <option value="Cozy cafe, morning sunlight">Quán cà phê ấm cúng, nắng sáng</option>
                                            <option value="Reading by the window">Đọc sách cạnh cửa sổ</option>
                                            <option value="Evening stroll, golden hour">Đi dạo phố, hoàng hôn</option>
                                        </optgroup>
                                        <optgroup label="📸 Fashion Shots">
                                            <option value="Mirror selfie, bedroom">OOTD trước gương</option>
                                            <option value="Urban street style">Street style trên phố</option>
                                            <option value="Studio lookbook, seamless background">Studio lookbook, nền trơn</option>
                                        </optgroup>
                                        <optgroup label="💼 Work/School">
                                            <option value="Office lobby, morning">Đi làm buổi sáng</option>
                                            <option value="Campus / workshop">Đi học / workshop</option>
                                        </optgroup>
                                        <optgroup label="💕 Date / Event">
                                            <option value="Date night dinner">Hẹn hò tối</option>
                                            <option value="Casual event, cocktail">Dự sự kiện nhẹ</option>
                                        </optgroup>
                                    </select>
                                </div>
                            </div>

                            <div className="influencer-section reference-section">
                                <h3 className="influencer-section-title">📷 Ảnh tham chiếu (Tùy chọn)</h3>
                                <div className="reference-grid">
                                    <div className="reference-uploader">
                                        <ImageUploader
                                            image={influencerRefPreview}
                                            onImageSelect={handleInfluencerRefChange}
                                            onRemove={handleRemoveInfluencerRef}
                                        >
                                            <p>+ Tải ảnh mẫu<br />(Style/Face/Body/Outfit)</p>
                                        </ImageUploader>
                                    </div>
                                    <div className="reference-options">
                                        <label className="influencer-label">AI nên lấy đặc điểm gì?</label>
                                        <div className="reference-option-grid">
                                            <button
                                                className={`option-chip ${influencerRefOptions.style ? 'active' : ''}`}
                                                onClick={() => toggleInfluencerRefOption('style')}
                                            >
                                                {influencerRefOptions.style && <span className="chip-check">✓</span>}
                                                <span>🎨 Phong cách</span>
                                            </button>
                                            <button
                                                className={`option-chip ${influencerRefOptions.face ? 'active' : ''}`}
                                                onClick={() => toggleInfluencerRefOption('face')}
                                            >
                                                {influencerRefOptions.face && <span className="chip-check">✓</span>}
                                                <span>👤 Khuôn mặt</span>
                                            </button>
                                            <button
                                                className={`option-chip ${influencerRefOptions.body ? 'active' : ''}`}
                                                onClick={() => toggleInfluencerRefOption('body')}
                                            >
                                                {influencerRefOptions.body && <span className="chip-check">✓</span>}
                                                <span>🧍 Dáng người</span>
                                            </button>
                                            <button
                                                className={`option-chip ${influencerRefOptions.outfit ? 'active' : ''}`}
                                                onClick={() => toggleInfluencerRefOption('outfit')}
                                            >
                                                {influencerRefOptions.outfit && <span className="chip-check">✓</span>}
                                                <span>🧥 Trang phục</span>
                                            </button>
                                        </div>
                                        <div className="reference-hint">Có thể chọn nhiều mục.</div>
                                    </div>
                                </div>
                            </div>

                            <div className="influencer-section">
                                <h3 className="influencer-section-title">⚙️ Cài đặt ảnh</h3>
                                <div className="settings-row">
                                    <div className="setting-group compact">
                                        <label className="setting-label">📐 Khung hình</label>
                                        <div className="toggle-group">
                                            <button
                                                className={`toggle-btn small ${influencerAspectRatio === '9:16' ? 'active' : ''}`}
                                                onClick={() => setInfluencerAspectRatio('9:16')}
                                            >
                                                📱 Dọc 9:16
                                            </button>
                                            <button
                                                className={`toggle-btn small ${influencerAspectRatio === '16:9' ? 'active' : ''}`}
                                                onClick={() => setInfluencerAspectRatio('16:9')}
                                            >
                                                💻 Ngang 16:9
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="influencer-section influencer-prompt-section">
                                <h3 className="influencer-section-title">📝 Prompt tạo ảnh (có thể chỉnh sửa)</h3>
                                <textarea
                                    className="influencer-prompt-textarea"
                                    value={influencerPrompt}
                                    onChange={(e) => setInfluencerPrompt(e.target.value)}
                                    rows={10}
                                    spellCheck={false}
                                />
                                <div className="reference-hint">Prompt này sẽ được gửi trực tiếp tới AI khi bấm “Tạo AI Influencer”.</div>
                            </div>

                            {/* Randomize & Generate */}
                            <div className="influencer-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        // Randomize all options
                                        const genders = ['Female', 'Male', 'Non-binary', 'Androgynous'];
                                        const ages = ['18-20', '20s', '30s', '40s'];
                                        const ethnicities = ['Việt Nam - Miền Bắc', 'Việt Nam - Miền Trung', 'Việt Nam - Miền Nam'];
                                        const skinTones = ['Very Fair (Porcelain)', 'Fair (Light)', 'Medium (Nude)', 'Tan', 'Medium Brown'];
                                        const hairLengths = ['Long', 'Shoulder-length', 'Short bob', 'Pixie cut'];
                                        const hairColors = ['Natural black', 'Chocolate brown', 'Chestnut brown', 'Ash brown', 'Honey blonde', 'Platinum blonde', 'Burgundy', 'Smoky gray'];
                                        const hairTextures = ['Straight silky', 'Soft wavy', 'Loose curls', 'Tight curls'];
                                        const hairBangs = ['Airy bangs', 'Blunt bangs', 'Curtain bangs', 'No bangs'];
                                        const eyeColors = ['Brown', 'Dark brown', 'Amber', 'Green', 'Blue', 'Gray'];
                                        const bodies = ['Slim & fit', 'Slim', 'Balanced', 'Athletic', 'Curvy', 'Tall & slim', 'Petite'];
                                        const styles = ['Cute casual', 'Modern luxury', 'Minimalist', 'Korean chic', 'Streetwear', 'Preppy', 'Office core', 'Vintage', 'Y2K', 'Coquette'];
                                        const scenarios = [
                                            'Cozy cafe, morning sunlight', 'Reading by the window', 'Evening stroll, golden hour',
                                            'Mirror selfie, bedroom', 'Urban street style', 'Studio lookbook, seamless background',
                                            'Office lobby, morning', 'Campus / workshop', 'Date night dinner', 'Casual event, cocktail'
                                        ];

                                        setInfluencerGender(genders[Math.floor(Math.random() * genders.length)]);
                                        setInfluencerAge(ages[Math.floor(Math.random() * ages.length)]);
                                        setInfluencerEthnicity(ethnicities[Math.floor(Math.random() * ethnicities.length)]);
                                        setInfluencerSkinTone(skinTones[Math.floor(Math.random() * skinTones.length)]);
                                        setInfluencerHairLength(hairLengths[Math.floor(Math.random() * hairLengths.length)]);
                                        setInfluencerHairColor(hairColors[Math.floor(Math.random() * hairColors.length)]);
                                        setInfluencerHairTexture(hairTextures[Math.floor(Math.random() * hairTextures.length)]);
                                        setInfluencerHairBangs(hairBangs[Math.floor(Math.random() * hairBangs.length)]);
                                        setInfluencerEyeColor(eyeColors[Math.floor(Math.random() * eyeColors.length)]);
                                        setInfluencerBody(bodies[Math.floor(Math.random() * bodies.length)]);
                                        setInfluencerStyle(styles[Math.floor(Math.random() * styles.length)]);
                                        setInfluencerScenario(scenarios[Math.floor(Math.random() * scenarios.length)]);
                                    }}
                                >
                                    🎲 Ngẫu nhiên hóa
                                </button>

                                <button
                                    className="btn btn-primary"
                                    onClick={handleGenerateInfluencer}
                                    disabled={isGeneratingInfluencer}
                                    style={{ padding: '16px 40px', fontSize: '1.1rem' }}
                                >
                                    {isGeneratingInfluencer ? '🎨 Đang tạo...' : '🚀 Tạo AI Influencer'}
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Result Display */}
                    {(isGeneratingInfluencer || influencerResult) && (
                        <section className="result-card full-width">
                            <h2>✨ Kết Quả AI Influencer</h2>

                            <div className="image-container">
                                {isGeneratingInfluencer && (
                                    <div className="loader-container">
                                        <div className="spinner"></div>
                                        <p>AI đang tạo influencer...</p>
                                    </div>
                                )}
                                {influencerResult && <img src={influencerResult} alt="AI Influencer result" />}
                            </div>

                            {influencerResult && (
                                <div className="action-buttons" style={{ justifyContent: 'center', marginTop: '1.5rem' }}>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => handleDownload(influencerResult, 'ai-influencer', '4k')}
                                    >
                                        💾 Tải ảnh PNG (4K)
                                    </button>
                                    <button
                                        className="btn btn-primary"
                                        onClick={async () => {
                                            if (influencerResult) {
                                                const file = await dataUrlToFile(influencerResult, 'ai-influencer-tryon.png');
                                                if (file) {
                                                    setModelFile(file);
                                                    setModelPreview(influencerResult);
                                                    setTopImage(null);
                                                    setBottomImage(null);
                                                    setSkirtImage(null);
                                                    setShoesImage(null);
                                                    setJewelryImage(null);
                                                    setBagImage(null);
                                                    setRefImages([null, null, null]);
                                                    handleTabChange('try-on');
                                                }
                                            }
                                        }}
                                        style={{ background: 'linear-gradient(135deg, #4caf50, #2e7d32)' }}
                                    >
                                        📤 Nạp vào Try-on
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            if (influencerResult) {
                                                handleAutoFixSkin(influencerResult);
                                            }
                                        }}
                                    >
                                        ✨ Fix da nhựa
                                    </button>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            if (influencerResult) {
                                                handleAutoBreastAug(influencerResult);
                                            }
                                        }}
                                    >
                                        👙 Nâng ngực
                                    </button>
                                </div>
                            )}
                        </section>
                    )}
                </main>
            )}
        </>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}


