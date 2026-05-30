import { Fragment } from 'react'

// Minimal, dependency-free renderer for the legal markdown in /content.
// Supports exactly what those files use: `#`/`##` headings, `- ` unordered
// lists, `> ` blockquotes, `**bold**` inline, and blank-line-separated
// paragraphs (consecutive non-blank lines are kept as soft line breaks).
// Links/images/tables/code aren't used by the legal docs and are out of scope —
// if that ever changes, switch to a real markdown library.

function renderInline(text: string): React.ReactNode {
  // Split on **bold** spans; odd segments are the bold runs.
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-forest-green">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

export function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let para: string[] = []
  let list: string[] = []
  let key = 0

  const flushPara = () => {
    if (para.length === 0) return
    const lns = para
    blocks.push(
      <p key={key++} className="mt-4 font-dm-sans text-sm leading-relaxed text-forest-green/70">
        {lns.map((ln, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(ln)}
          </Fragment>
        ))}
      </p>,
    )
    para = []
  }

  const flushList = () => {
    if (list.length === 0) return
    const items = list
    blocks.push(
      <ul key={key++} className="mt-3 space-y-1.5 pl-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 font-dm-sans text-sm leading-relaxed text-forest-green/70">
            <span className="mt-[2px] shrink-0 text-forest-green/40">•</span>
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>,
    )
    list = []
  }

  const flush = () => { flushPara(); flushList() }

  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') { flush(); continue }

    if (line.startsWith('## ')) {
      flush()
      blocks.push(
        <h2 key={key++} className="mt-8 font-fraunces text-xl font-semibold text-forest-green">
          {renderInline(line.slice(3))}
        </h2>,
      )
      continue
    }
    if (line.startsWith('# ')) {
      flush()
      blocks.push(
        <h1 key={key++} className="font-fraunces text-3xl font-semibold text-forest-green">
          {renderInline(line.slice(2))}
        </h1>,
      )
      continue
    }
    if (line.startsWith('> ')) {
      flush()
      blocks.push(
        <blockquote
          key={key++}
          className="mt-4 border-l-2 border-forest-green/20 bg-forest-green/[0.03] py-2 pl-4 pr-3 font-dm-sans text-xs italic leading-relaxed text-forest-green/55"
        >
          {renderInline(line.slice(2))}
        </blockquote>,
      )
      continue
    }
    if (/^[-*] /.test(line)) {
      flushPara() // a list can directly follow a label line
      list.push(line.slice(2))
      continue
    }

    // Plain text line — part of a paragraph. Lists end here.
    flushList()
    para.push(line)
  }
  flush()
  return blocks
}
