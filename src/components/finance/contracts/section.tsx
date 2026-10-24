/** Раздел карточки: подпись, число и черта до края. Им же размечены досье участника и начисления. */
export function Section({
  title,
  count,
  end,
  children,
}: {
  title: string;
  count?: number;
  end?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="card-section">
        <span>
          {title}
          {count ? <span className="fin-muted" style={{ fontWeight: 400 }}> {count}</span> : null}
        </span>
        <span className="card-section-line" />
        {end ? <span className="card-section-end">{end}</span> : null}
      </div>
      {children}
    </section>
  );
}
