import { h } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import WindowedList from './WindowedList.jsx';

export default function WindowedAlbumGrid({ albums, renderAlbum }) {
  const rootRef = useRef(null);
  const [layout, setLayout] = useState({ columns: 1, gap: 22, estimatedHeight: 250 });
  useLayoutEffect(() => {
    const element = rootRef.current;
    const measure = () => {
      const narrow = window.innerWidth <= 640;
      const minimumWidth = narrow ? 130 : 170;
      const gap = narrow ? 14 : 22;
      const width = element.clientWidth;
      const columns = Math.max(1, Math.floor((width + gap) / (minimumWidth + gap)));
      const estimatedHeight = (width - (columns - 1) * gap) / columns + 48 + gap;
      setLayout(previous => previous.columns === columns && previous.gap === gap && previous.estimatedHeight === estimatedHeight
        ? previous : { columns, gap, estimatedHeight });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const rows = useMemo(() => {
    const result = [];
    for (let index = 0; index < albums.length; index += layout.columns) result.push(albums.slice(index, index + layout.columns));
    return result;
  }, [albums, layout.columns]);

  return <div ref={rootRef}>
    {albums.length <= 120 ? <div class="album-grid">{albums.map(renderAlbum)}</div> : <WindowedList
      items={rows}
      itemKey={row => row[0].Id}
      estimatedHeight={layout.estimatedHeight}
      threshold={0}
      renderItem={(row, rowIndex) => <div class="album-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, paddingBottom: `${layout.gap}px`, gap: `${layout.gap}px` }}>
        {row.map((album, column) => renderAlbum(album, rowIndex * layout.columns + column))}
      </div>}
    />}
  </div>;
}
