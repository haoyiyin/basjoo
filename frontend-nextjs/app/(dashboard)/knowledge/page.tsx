'use client';

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function KnowledgePage() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/', { replace: true }); }, [navigate]);
  return null;
}
