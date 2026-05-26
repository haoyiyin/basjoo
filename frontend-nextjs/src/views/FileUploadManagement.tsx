'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../services/api'
import type { FileItem } from '../services/api';
import AdminLayout from '../components/AdminLayout';
import KBSetupGuard from '../components/KBSetupGuard';
import { useIsMobile } from '../hooks/useMediaQuery';
import SourcesSummary from '../components/SourcesSummary';

interface TaskStatus {
  is_crawling: boolean;
  is_rebuilding: boolean;
  can_modify_index: boolean;
  active_tasks: string[];
}

export default function FileUploadManagement() {
  const { t } = useTranslation('common');
  const { agentId: routeAgentId } = useParams<{ agentId?: string }>();
  const isMobile = useIsMobile();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const taskStatusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDefaultAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeAgentId]);

  const loadDefaultAgent = async () => {
    try {
      if (!routeAgentId) return;
      const data = await api.getAgent(routeAgentId);
      setAgentId(data.id);
    } catch (error) {
      alert(`${t('errors.loadAgentFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    }
  };

  const loadFiles = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await api.listFiles(agentId);
      setFiles(data.files);
    } catch (error) {
      alert(`${t('errors.loadFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setLoading(false);
    }
  }, [agentId, t]);

  // Stable refs for functions used inside interval callbacks.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const loadFilesRef = useRef(loadFiles);
  loadFilesRef.current = loadFiles;

  useEffect(() => {
    isMountedRef.current = true;
    if (agentId) {
      void loadFiles();
      const pollTaskStatus = async () => {
        if (!isMountedRef.current || !agentIdRef.current) return;
        try {
          const status = await api.getTasksStatus(agentIdRef.current);
          if (!isMountedRef.current) return;
          setTaskStatus(prev => {
            if (
              prev &&
              prev.is_crawling === status.is_crawling &&
              prev.is_rebuilding === status.is_rebuilding &&
              prev.can_modify_index === status.can_modify_index &&
              prev.active_tasks.length === status.active_tasks.length &&
              prev.active_tasks.every((task, index) => task === status.active_tasks[index])
            ) {
              return prev;
            }
            return status;
          });
        } catch (error) {
          console.error('Failed to poll task status:', error);
        }
      };
      void pollTaskStatus();
      taskStatusIntervalRef.current = setInterval(pollTaskStatus, 3000);
    }
    return () => {
      isMountedRef.current = false;
      if (taskStatusIntervalRef.current) {
        clearInterval(taskStatusIntervalRef.current);
      }
    };
  }, [agentId, loadFiles]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = async (selectedFiles: File[]) => {
    if (!agentId || selectedFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(t('files.uploading', { count: selectedFiles.length }));
    try {
      const result = await api.uploadFiles(agentId, selectedFiles);
      if (result.failed > 0) {
        alert(t('files.uploadPartial', { uploaded: result.uploaded, failed: result.failed }));
      }
      await loadFiles();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert(`${t('files.uploadFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!agentId) return;
    if (!confirm(t('files.confirmDelete'))) return;

    setDeletingFileId(fileId);
    try {
      await api.deleteFile(agentId, fileId);
      await loadFiles();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert(`${t('errors.deleteFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setDeletingFileId(null);
    }
  };

  const handleClearAll = () => {
    if (!agentId) return;
    if (files.length === 0) return;
    setShowClearConfirm(true);
  };

  const confirmClearAll = async () => {
    if (!agentId) return;

    setClearing(true);
    try {
      const result = await api.clearAllFiles(agentId);
      setShowClearConfirm(false);
      await loadFiles();
      setRefreshTrigger(prev => prev + 1);
      alert(t('files.clearSuccess', { count: result.deleted_count }));
    } catch (error) {
      alert(`${t('files.clearFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setClearing(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileTypeIcon = (fileType: string) => {
    const type = fileType.toLowerCase();
    if (type.includes('pdf')) {
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    }
    if (type.includes('csv') || type.includes('json')) {
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      );
    }
    if (type.includes('doc')) {
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    }
    // Default text file icon
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { className: string; label: string }> = {
      ready: { className: 'badge badge-success', label: t('files.ready') },
      processing: { className: 'badge badge-warning badge-pulse', label: t('files.processing') },
      uploading: { className: 'badge badge-info', label: t('files.uploadingStatus') },
      pending: { className: 'badge badge-info', label: t('files.pending') },
      failed: { className: 'badge badge-error', label: t('status.failed') },
    };
    return styles[status] || { className: 'badge', label: status };
  };

  return (
    <AdminLayout>
      {agentId ? (
        <KBSetupGuard agentId={agentId}>
          {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-4)',
            zIndex: 1000,
          }}
        >
          <div
            className="glass-modal"
            style={{
              width: '100%',
              maxWidth: '420px',
              padding: 'var(--space-6)',
            }}
          >
            <h3 style={{ margin: 0, marginBottom: 'var(--space-3)', fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)' }}>
              {t('files.clearAll')}
            </h3>
            <p style={{ margin: 0, marginBottom: 'var(--space-5)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {t('files.confirmClearAll')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                {t('buttons.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={confirmClearAll}
                disabled={clearing}
                style={{ background: 'var(--color-error)', borderColor: 'var(--color-error)' }}
              >
                {clearing ? t('files.clearing') : t('buttons.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{
        padding: isMobile ? 'var(--space-4)' : 'var(--space-8)',
        maxWidth: '1400px',
        margin: '0 auto',
      }}>
        <header style={{
          marginBottom: 'var(--space-8)',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 'var(--space-4)' : '0',
        }}>
          <div>
            <h1 style={{
              fontSize: isMobile ? 'var(--text-2xl)' : 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 'var(--space-2)',
            }}>
              {t('navigation.fileManagement')}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
            }}>
              {t('files.description')}
            </p>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            flexWrap: 'wrap',
          }}>
          </div>
        </header>

        <div className="responsive-grid-2" style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 300px',
          gap: 'var(--space-6)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <div className="liquid-glass-card" style={{ padding: 'var(--space-6)' }}>
              <h2 style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 600,
                marginBottom: 'var(--space-6)',
                color: 'var(--color-text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {t('files.uploadTitle')}
              </h2>

              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragActive ? 'var(--color-accent-primary)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-xl)',
                  padding: 'var(--space-8)',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: dragActive ? 'hsla(188deg, 90%, 50%, 0.06)' : 'var(--color-bg-tertiary)',
                  transition: 'all var(--transition-base)',
                  transform: dragActive ? 'scale(1.01)' : 'scale(1)',
                  boxShadow: dragActive ? 'inset 0 0 30px hsla(188deg, 90%, 50%, 0.08)' : 'none',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt,.json,.csv,.md,.docx,.doc,.html,.htm,.xml"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto var(--space-4)', color: 'var(--color-text-muted)' }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p style={{
                  fontSize: 'var(--text-base)',
                  color: 'var(--color-text-primary)',
                  fontWeight: 500,
                  marginBottom: 'var(--space-2)',
                }}>
                  {t('files.dropzoneText')}
                </p>
                <p style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-muted)',
                }}>
                  {t('files.supportedFormats')}
                </p>
              </div>

              {uploadProgress && (
                <div style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3)',
                  background: 'rgba(6, 182, 212, 0.1)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  color: 'var(--color-accent-primary)',
                  fontSize: 'var(--text-sm)',
                }}>
                  <div className="spinner" style={{ width: '14px', height: '14px' }} />
                  {uploadProgress}
                </div>
              )}
            </div>

            <div className="liquid-glass-card" style={{ padding: 'var(--space-6)' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-6)',
              }}>
                <h2 style={{
                  fontSize: 'var(--text-lg)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                  {t('files.fileList')}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {files.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAll}
                      disabled={clearing}
                      className="btn-ghost"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        color: 'var(--color-error)',
                        opacity: clearing ? 0.5 : 1,
                        cursor: clearing ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {clearing ? (
                        <>
                          <div className="spinner" style={{ width: '14px', height: '14px' }} />
                          {t('files.clearing')}
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          {t('files.clearAll')}
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => void loadFiles()}
                    disabled={loading}
                    className="btn-ghost"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                    }}
                  >
                    {loading ? (
                      <div className="spinner" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                    )}
                    {t('buttons.refresh')}
                  </button>
                </div>
              </div>

              <div style={{
                maxHeight: '500px',
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-3)',
              }}>
                {files.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: 'var(--space-12)',
                    color: 'var(--color-text-muted)',
                  }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto var(--space-4)' }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <p style={{ fontSize: 'var(--text-base)' }}>{t('files.noFiles')}</p>
                    <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>{t('files.uploadHint')}</p>
                  </div>
                ) : (
                  files.map((file) => (
                    <div
                      key={file.id}
                      style={{
                        padding: 'var(--space-4)',
                        background: file.status === 'ready' ? 'var(--color-bg-tertiary)' : (file.status === 'processing' || file.status === 'uploading' || file.status === 'pending') ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        borderRadius: 'var(--radius-md)',
                        border: file.status === 'ready' ? '1px solid var(--color-border)' : (file.status === 'processing' || file.status === 'uploading' || file.status === 'pending') ? '2px solid var(--color-warning)' : '2px solid var(--color-error)',
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'var(--space-4)',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            marginBottom: 'var(--space-2)',
                          }}>
                            <span className={getStatusBadge(file.status).className}>
                              {getStatusBadge(file.status).label}
                            </span>
                            <span style={{
                              display: 'flex',
                              color: 'var(--color-text-muted)',
                            }}>
                              {getFileTypeIcon(file.file_type)}
                            </span>
                          </div>
                          <div style={{
                            fontSize: 'var(--text-sm)',
                            fontWeight: 500,
                            color: 'var(--color-text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {file.filename}
                          </div>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            marginTop: 'var(--space-1)',
                          }}>
                            <span style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--color-text-muted)',
                            }}>
                              {formatFileSize(file.file_size)}
                            </span>
                            <span style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--color-text-muted)',
                              textTransform: 'uppercase',
                            }}>
                              {file.file_type}
                            </span>
                            <span style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--color-text-muted)',
                            }}>
                              {new Date(file.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(file.id)}
                          disabled={deletingFileId === file.id}
                          className="btn-ghost"
                          style={{
                            color: 'var(--color-error)',
                            padding: 'var(--space-2)',
                            opacity: deletingFileId === file.id ? 0.5 : 1,
                            cursor: deletingFileId === file.id ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {deletingFileId === file.id ? (
                            <div className="spinner" style={{ width: '14px', height: '14px' }} />
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Sources Summary - Desktop: right column */}
          {!isMobile && agentId && (
            <div style={{ position: 'sticky', top: 'var(--space-8)' }}>
              <SourcesSummary
                agentId={agentId}
                refreshTrigger={refreshTrigger}
              />
            </div>
          )}
        </div>

        {/* Mobile: Sources Summary at bottom */}
        {isMobile && agentId && (
          <div style={{ marginTop: 'var(--space-6)' }}>
            <SourcesSummary
              agentId={agentId}
              refreshTrigger={refreshTrigger}
            />
          </div>
        )}
      </div>
        </KBSetupGuard>
      ) : (
        <div style={{ padding: isMobile ? 'var(--space-4)' : 'var(--space-8)', textAlign: 'center' }}>
          <div className="spinner" />
        </div>
      )}
    </AdminLayout>
  );
}
