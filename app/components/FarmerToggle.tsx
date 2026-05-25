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
    <div className={`flex rounded-lg border border-forest-green/15 bg-cream p-0.5 ${className}`}>
      {(['livestock', 'rowcrop'] as const).map(m => (
        <button
          key={m}
          onClick={() => handleChange(m)}
          className={[
            'rounded-md px-4 py-2 text-sm font-semibold font-dm-sans',
            mode === m
              ? 'bg-forest-green text-white'
              : 'text-forest-green/60 hover:text-forest-green',
          ].join(' ')}
        >
          {m === 'livestock' ? 'Livestock' : 'Row Crop'}
        </button>
      ))}
    </div>
  )
}
