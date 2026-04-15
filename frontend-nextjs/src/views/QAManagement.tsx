'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api'
import type { QAItem } from '../services/api';
import AdminLayout from '../components/AdminLayout';
import HelpTooltip from '../components/HelpTooltip';
import { useIsMobile } from '../hooks/useMediaQuery';
import SourcesSummary from '../components/SourcesSummary';

interface ParsedQAItem {
  id: string;
  question: string;
  answer: string;
}

interface TaskStatus {
  is_crawling: boolean;
  is_rebuilding: boolean;
  can_modify_index: boolean;
  active_tasks: string[];
}

export default function QAManagement() {
  const { t } = useTranslation('common');
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [items, setItems] = useState<QAItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jinaKeyReady, setJinaKeyReady] = useState<boolean | null>(null);
  const [importText, setImportText] = useState('');
  const [importFormat, setImportFormat] = useState<'json' | 'csv'>('json');
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  const [isRetraining, setIsRetraining] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const taskStatusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(false);
  const wasRetrainingRef = useRef(false);
  const jinaKeyCheckInFlightRef = useRef(false);
  const redirectedForJinaKeyRef = useRef(false);

  useEffect(() => {
    loadDefaultAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!agentId || jinaKeyCheckInFlightRef.current || jinaKeyReady !== null) return;
    // 检查开始时设为 null，表示检查中，不显示警告
    setJinaKeyReady(null);
    jinaKeyCheckInFlightRef.current = true;
    const checkJinaKey = async () => {
      try {
        const status = await api.getJinaKeyStatus(agentId);
        if (!status.configured) {
          setJinaKeyReady(false);
          if (!redirectedForJinaKeyRef.current) {
            redirectedForJinaKeyRef.current = true;
            navigate('/playground?highlightJinaKey=true');
          }
        } else {
          redirectedForJinaKeyRef.current = false;
          setJinaKeyReady(true);
        }
      } catch {
        setJinaKeyReady(false);
        if (!redirectedForJinaKeyRef.current) {
          redirectedForJinaKeyRef.current = true;
          navigate('/playground?highlightJinaKey=true');
        }
      } finally {
        jinaKeyCheckInFlightRef.current = false;
      }
    };
    checkJinaKey();
  }, [agentId, jinaKeyReady, navigate]);

  const loadDefaultAgent = async () => {
    try {
      const data = await api.getDefaultAgent();
      setAgentId(data.id);
    } catch (error) {
      alert(`${t('errors.loadAgentFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    }
  };

  const loadItems = async (showAlert = true) => {
    if (!agentId || !jinaKeyReady) return;
    setLoading(true);
    try {
      const data = await api.listQA(agentId, 0, 1000);
      setItems(data.items);
    } catch (error) {
      if (showAlert) {
        alert(`${t('errors.loadFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
      } else {
        console.error('Failed to load QA items:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  // Stable refs for functions used inside interval callbacks.
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;
  const loadItemsRef = useRef(loadItems);
  loadItemsRef.current = loadItems;

  useEffect(() => {
    isMountedRef.current = true;
    if (agentId && jinaKeyReady) {
      void loadItems(false);
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
          if (status.is_rebuilding) {
            wasRetrainingRef.current = true;
            setIsRetraining(true);
          } else {
            setIsRetraining(false);
            if (wasRetrainingRef.current) {
              wasRetrainingRef.current = false;
              setRefreshTrigger(t => t + 1);
              void loadItemsRef.current(false);
            }
          }
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
  }, [agentId, jinaKeyReady]);

  // 解析导入内容为Q&A项目
  const parseImportContent = (text: string, format: 'json' | 'csv'): ParsedQAItem[] => {
    const result: ParsedQAItem[] = [];
    
    if (format === 'json') {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          parsed.forEach((item, index) => {
            if (item.question && item.answer) {
              result.push({
                id: `pending_${Date.now()}_${index}`,
                question: item.question,
                answer: item.answer,
              });
            }
          });
        }
      } catch {
        throw new Error(t('errors.invalidJson'));
      }
    } else {
      // CSV format
      const lines = text.split('\n').filter(line => line.trim());
      lines.forEach((line, index) => {
        const parts = line.split(/[,\t]/);
        if (parts.length >= 2) {
          result.push({
            id: `pending_${Date.now()}_${index}`,
            question: parts[0].trim(),
            answer: parts.slice(1).join(',').trim(),
          });
        }
      });
    }
    
    return result;
  };

  // 直接导入到数据库
  const handleImportToDatabase = async () => {
    if (!agentId || !jinaKeyReady) return;
    if (!importText.trim()) {
      alert(t('errors.qaContentRequired'));
      return;
    }

    try {
      const parsed = parseImportContent(importText, importFormat);
      if (parsed.length === 0) {
        alert(t('errors.noValidQaItems'));
        return;
      }
      
      setSaving(true);
      const content = JSON.stringify(parsed.map(item => ({
        question: item.question,
        answer: item.answer,
      })));
      const importResult = await api.importQA(agentId, content, 'json', false);
      
      if (importResult.imported === 0) {
        alert(t('errors.importFailed'));
        return;
      }

      setImportText('');
      await loadItems();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert(`${t('errors.importFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    } finally {
      setSaving(false);
    }
  };

  // 清空导入输入框
  const handleClearImportText = () => {
    if (importText.trim()) {
      const confirmed = confirm(t('labels.qa.confirmClearImport'));
      if (!confirmed) return;
    }
    setImportText('');
  };

  // 重新训练智能体
  const handleRetrain = async () => {
    if (!agentId || !jinaKeyReady) return;
    
    if (taskStatus?.is_crawling) {
      alert(t('labels.qa.crawlInProgress'));
      return;
    }
    if (taskStatus?.is_rebuilding) {
      alert(t('labels.qa.rebuildInProgress'));
      return;
    }
    
    setIsRetraining(true);
    try {
      await api.rebuildIndex(agentId, true);
      // 轮询会自动处理训练完成后的状态更新
    } catch (error) {
      alert(`${t('sources.retrainFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
      setIsRetraining(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!jinaKeyReady) return;
    if (!confirm(t('labels.confirmDelete'))) return;

    try {
      await api.deleteQA(id);
      await loadItems();
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      alert(`${t('errors.deleteFailed')}: ${error instanceof Error ? error.message : t('errors.unknown')}`);
    }
  };

  const loadSample = () => {
    setImportText(JSON.stringify([
      { question: t('labels.sampleQuestion1'), answer: t('labels.sampleAnswer1') },
      { question: t('labels.sampleQuestion2'), answer: t('labels.sampleAnswer2') },
      { question: t('labels.sampleQuestion3'), answer: t('labels.sampleAnswer3') },
    ], null, 2));
    setImportFormat('json');
  };

  return (
    <AdminLayout>
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
              {t('navigation.qaManagement')}
            </h1>
            <p style={{
              color: 'var(--color-text-secondary)',
            }}>
              {t('labels.manageQa')}
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
          {jinaKeyReady === false && (
            <div style={{
              gridColumn: isMobile ? 'auto' : '1 / -1',
              padding: 'var(--space-3)',
              marginBottom: 'var(--space-2)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: '#ef4444',
              fontSize: 'var(--text-sm)',
            }}>
              {t('labels.jinaKeyRequired')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
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
              {t('labels.batchImport')}
              <HelpTooltip
                title={t('labels.qaBatchImport')}
                content={[
                  t('labels.qaBatchImportDesc'),
                  t('labels.supportFormats'),
                  t('labels.jsonFormat'),
                  t('labels.csvFormat')
                ]}
                position="top"
                size="sm"
              />
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  marginBottom: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                }}>
                  {t('labels.format')}
                  <HelpTooltip
                    title={t('labels.jsonFormatSample')}
                    content={[
                      '[',
                      `  {"question": "${t('labels.question1')}", "answer": "${t('labels.answer1')}"},`,
                      `  {"question": "${t('labels.question2')}", "answer": "${t('labels.answer2')}"}`,
                      ']'
                    ]}
                    position="top"
                    size="sm"
                  />
                </label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  {(['json', 'csv'] as const).map((format) => (
                    <button
                      key={format}
                      onClick={() => setImportFormat(format)}
                      style={{
                        padding: 'var(--space-2) var(--space-4)',
                        background: importFormat === format ? 'var(--color-accent-primary)' : 'var(--color-bg-tertiary)',
                        color: importFormat === format ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontSize: 'var(--text-sm)',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                      }}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                }}>
                  {t('labels.content')}
                </label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={importFormat === 'json'
                    ? '[{"question": "' + t('placeholders.question') + '", "answer": "' + t('placeholders.answer') + '"}]'
                    : t('placeholders.csvFormat')}
                  rows={12}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-sm)',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button
                  onClick={handleImportToDatabase}
                  disabled={!importText.trim() || saving || !jinaKeyReady}
                  style={{
                    flex: 1,
                    padding: 'var(--space-3)',
                    background: 'var(--color-accent-gradient)',
                    color: 'var(--color-text-inverse)',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    cursor: (!importText.trim() || saving) ? 'not-allowed' : 'pointer',
                    opacity: (!importText.trim() || saving) ? 0.5 : 1,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--space-2)',
                  }}
                >
                  {saving ? (
                    <>
                      <div className="spinner" style={{ width: '14px', height: '14px' }} />
                      {t('status.importing')}
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      {t('buttons.import')}
                    </>
                  )}
                </button>
                <button
                  onClick={handleClearImportText}
                  disabled={!importText.trim()}
                  className="btn-secondary"
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    opacity: !importText.trim() ? 0.5 : 1,
                    cursor: !importText.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t('buttons.clear')}
                </button>
                <button
                  onClick={loadSample}
                  className="btn-secondary"
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                  }}
                >
                  {t('labels.loadSample')}
                </button>
              </div>
            </div>
          </div>

          <div className="glass-card" style={{ padding: 'var(--space-6)' }}>
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
                {t('labels.qaList')}
              </h2>
              <button
                onClick={() => { void loadItems(); }}
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

            <div style={{
              maxHeight: '500px',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}>
              {/* 已保存的项目 */}
              {items.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: 'var(--space-12)',
                  color: 'var(--color-text-muted)',
                }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto var(--space-4)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <p style={{ fontSize: 'var(--text-base)' }}>{t('labels.noQaData')}</p>
                  <p style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>{t('labels.pleaseImportFirst')}</p>
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 'var(--space-4)',
                      background: item.is_indexed ? 'var(--color-bg-tertiary)' : 'rgba(245, 158, 11, 0.1)',
                      borderRadius: 'var(--radius-md)',
                      border: item.is_indexed ? '1px solid var(--color-border)' : '2px solid var(--color-warning)',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 'var(--space-4)',
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-2)',
                          marginBottom: 'var(--space-2)',
                        }}>
                          <span 
                            className={item.is_indexed ? 'badge badge-success' : 'badge badge-warning'}
                            style={{ fontSize: 'var(--text-xs)' }}
                          >
                            {item.is_indexed ? t('sources.trained') : t('sources.pending')}
                          </span>
                        </div>
                        <h3 style={{
                          fontSize: 'var(--text-sm)',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                          marginBottom: 'var(--space-2)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--space-2)',
                        }}>
                          <span style={{ color: 'var(--color-accent-primary)' }}>Q:</span>
                          {item.question}
                        </h3>
                        <p style={{
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.6,
                        }}>
                          <span style={{ color: 'var(--color-success)', fontWeight: 500 }}>A: </span>
                          {item.answer}
                        </p>
                        {item.tags && item.tags.length > 0 && (
                          <div style={{
                            marginTop: 'var(--space-3)',
                            display: 'flex',
                            gap: 'var(--space-2)',
                            flexWrap: 'wrap',
                          }}>
                            {item.tags.map((tag, idx) => (
                              <span
                                key={idx}
                                className="badge badge-info"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={!jinaKeyReady}
                        className="btn-ghost"
                        style={{
                          color: 'var(--color-error)',
                          padding: 'var(--space-2)',
                          opacity: !jinaKeyReady ? 0.5 : 1,
                          cursor: !jinaKeyReady ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          </div>

          {/* Sources Summary - Desktop: third column */}
          {!isMobile && agentId && (
            <div style={{ position: 'sticky', top: 'var(--space-8)' }}>
              <SourcesSummary
                agentId={agentId}
                onRetrain={handleRetrain}
                isRetraining={isRetraining}
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
              onRetrain={handleRetrain}
              isRetraining={isRetraining}
              refreshTrigger={refreshTrigger}
            />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
