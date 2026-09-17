import React, { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { I } from './Icons.jsx';

/* ============================ ALERT ============================ */
const IK = { ok: I.check, err: I.alert, warn: I.alert, info: I.info };

export function Alert({ tipe = 'info', judul, children, k = '' }) {
  const Ic = IK[tipe] || I.info;
  return (
    <div className={`alert alert-${tipe} ${k}`} role={tipe === 'err' ? 'alert' : 'status'}>
      <Ic />
      <div>
        {judul && <strong>{judul}</strong>}
        {children}
      </div>
    </div>
  );
}

/* ============================ TOAST ============================ */
const ToastCtx = createContext(() => {});
export const usePesan = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [list, setList] = useState([]);

  const say = useCallback((teks, tipe = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setList((l) => [...l, { id, teks, tipe }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tipe === 'err' ? 5200 : 3000);
  }, []);

  return (
    <ToastCtx.Provider value={say}>
      {children}
      {list.length > 0 && (
        <div className="toasts">
          {list.map((t) => {
            const Ic = t.tipe === 'err' ? I.alert : I.check;
            return (
              <div key={t.id} className={`toast ${t.tipe}`} role={t.tipe === 'err' ? 'alert' : 'status'}>
                <Ic />
                <span>{t.teks}</span>
              </div>
            );
          })}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/* ============================ TOMBOL ============================ */
export function Btn({ children, muat = false, jenis = 'g', k = '', ...p }) {
  return (
    <button
      className={`btn btn-${jenis} ${muat ? 'is-load' : ''} ${k}`}
      disabled={muat || p.disabled}
      {...p}
    >
      {children}
    </button>
  );
}

/* ============================ FIELD ============================ */
export function Field({ label, hint, galat, children, k = '' }) {
  return (
    <div className={`field ${galat ? 'err' : ''} ${k}`}>
      {label && <label>{label}</label>}
      {children}
      {galat ? (
        <span className="emsg"><I.alert /> {galat}</span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

/* ============================ SKELETON ============================ */
export function Skeleton({ pola = 'teks', n = 4 }) {
  const ulang = Array.from({ length: n });

  if (pola === 'stat')
    return (
      <div className="stats" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="stat">
            <span className="sk sk-txt sk-w40" />
            <span className="sk sk-h sk-w25" style={{ height: 30, margin: '10px 0 6px' }} />
            <span className="sk sk-txt sk-w60" style={{ marginBottom: 0 }} />
          </div>
        ))}
      </div>
    );

  if (pola === 'tabel')
    return (
      <div className="tw" aria-hidden="true">
        {ulang.map((_, i) => (
          <div key={i} className="sk-row">
            <span className="sk sk-sq" />
            <div className="b">
              <span className="sk sk-txt sk-w40" />
              <span className="sk sk-txt sk-w25" style={{ marginBottom: 0 }} />
            </div>
            <span className="sk sk-txt sk-w25" style={{ marginBottom: 0, maxWidth: 90 }} />
          </div>
        ))}
      </div>
    );

  if (pola === 'editor')
    return (
      <div aria-hidden="true">
        <span className="sk sk-h sk-w60" />
        <span className="sk sk-txt" />
        <span className="sk sk-txt sk-w90" />
        <span className="sk" style={{ height: 240, borderRadius: 8, marginTop: 18 }} />
      </div>
    );

  return (
    <div aria-hidden="true">
      {ulang.map((_, i) => (
        <span key={i} className={`sk sk-txt ${i === n - 1 ? 'sk-w60' : i % 3 === 1 ? 'sk-w90' : ''}`} />
      ))}
    </div>
  );
}

/* ============================ MEMUAT ============================ */
export function Memuat({ teks = 'Memuat…' }) {
  return (
    <div className="loading" role="status">
      <span className="spin lg" />
      <span>{teks}</span>
    </div>
  );
}

/* ============================ KOSONG ============================ */
export function Kosong({ judul, pesan, children, ikon: Ic = I.doc }) {
  return (
    <div className="card empty">
      <Ic />
      <h3 style={{ fontSize: 16, color: 'var(--txt)', marginBottom: 5 }}>{judul}</h3>
      {pesan && <p style={{ fontSize: 14, maxWidth: '42ch', margin: '0 auto' }}>{pesan}</p>}
      {children}
    </div>
  );
}

/* ============================ DROPDOWN ============================ */
export function Dropdown({ nilai, opsi, onPilih, label, lebar, kanan = false }) {
  const [buka, setBuka] = useState(false);
  const box = useRef(null);
  const terpilih = opsi.find((o) => o.v === nilai) ?? opsi[0];

  useEffect(() => {
    if (!buka) return;
    const luar = (e) => { if (!box.current?.contains(e.target)) setBuka(false); };
    const esc = (e) => { if (e.key === 'Escape') setBuka(false); };
    document.addEventListener('mousedown', luar);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', luar);
      document.removeEventListener('keydown', esc);
    };
  }, [buka]);

  return (
    <div className={`dd ${buka ? 'open' : ''}`} ref={box} style={lebar ? { width: lebar } : undefined}>
      <button
        type="button" className="dd-btn" aria-haspopup="listbox" aria-expanded={buka}
        aria-label={label} onClick={() => setBuka((b) => !b)}
      >
        <span className="dd-val">{terpilih?.t}</span>
        <I.chev className="dd-ar" />
      </button>
      {buka && (
        <div className={`dd-menu ${kanan ? 'right' : ''}`} role="listbox">
          {opsi.map((o) => (
            <button
              key={o.v} type="button" className="dd-it" role="option"
              aria-selected={o.v === nilai}
              onClick={() => { onPilih(o.v); setBuka(false); }}
            >
              <span className="dd-ck"><I.check /></span>
              <span>{o.t}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ MODAL ============================ */
export function Modal({ judul, children, aksi, onTutup, lebar = false }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onTutup();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onTutup]);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onTutup()}>
      <div className={`modal ${lebar ? "lebar" : ""}`} role="dialog" aria-modal="true" aria-label={judul}>
        <div className="modal-hd">
          <h2>{judul}</h2>
          <button className="btn btn-t icon" onClick={onTutup} aria-label="Tutup"><I.x /></button>
        </div>
        <div className="modal-bd">{children}</div>
        {aksi && <div className="modal-ft">{aksi}</div>}
      </div>
    </div>
  );
}
