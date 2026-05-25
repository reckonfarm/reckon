'use client'

import { useState, useEffect } from 'react'

export type FarmerMode = 'livestock' | 'rowcrop'
export const FARMER_TYPE_KEY = 'farmer_type'

interface Props {
  className?: string
}

export default function FarmerToggle({ className = '' }: Props) {
  const [mode, setMode] = useState<FarmerMode>('livestock')

  useEffect(() => {
    const stored = localStorage.getItem(FARMER_TYPE_KEY)
    if (stored === 'livestock' || stored === 'rowcrop') {
      setMode(stored)
    }
  }, [])

  function handleChange(next: FarmerMode) {
    setMode(next)
    localStorage.setItem(FARMER_TYPE_KEY, next)
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      {(['livestock', 'rowcrop'] as const).map(m => (
        <button
          key={m}
          onClick={() => handleChange(m)}
          style={mode === m ? { color: '#ffffff' } : undefined}
          className={[
            'rounded-full px-4 py-2 text-sm font-semibold font-dm-sans transition-colors',
            mode === m
              ? 'bg-forest-green'
              : 'border border-forest-green/30 text-forest-green hover:border-forest-green/60',
          ].join(' ')}
        >
          {m === 'livestock' ? 'Livestock' : 'Row Crop'}
        </button>
      ))}
    </div>
  )
}
