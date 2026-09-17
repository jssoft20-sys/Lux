import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { Page, Pager, Select, Table, Tag, Toolbar, useDebounced } from '@/components/ui';
import { dt, fmt } from '@/lib/format';

export default function UsersPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kyc, setKyc] = useState('');
  const [minRisk, setMinRisk] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const data = useQuery({ queryKey: ['users', dq, status, kyc, minRisk, page], queryFn: () => api<any>(`/users${qs({ q: dq, status, kyc, minRisk, page, limit: 30 })}`) });
  return (
    <Page title="Пользователи" subtitle="Поиск по телефону, ФИО, нику или ID">
      <Toolbar q={q} setQ={setQ} placeholder="+996 555…, ФИО, ник, ID">
        <Select value={status} onChange={setStatus} options={[['', 'Все статусы'], ['ACTIVE', 'Активные'], ['RESTRICTED', 'Ограничены'], ['FROZEN', 'Заморожены'], ['BANNED', 'Забанены']]} />
        <Select value={kyc} onChange={setKyc} options={[['', 'Любой KYC'], ['APPROVED', 'KYC пройден'], ['IN_REVIEW', 'На проверке'], ['NOT_STARTED', 'Не начат'], ['DECLINED', 'Отклонён']]} />
        <Select value={minRisk} onChange={setMinRisk} options={[['', 'Любой риск'], ['40', 'Риск ≥ 40'], ['70', 'Риск ≥ 70']]} />
      </Toolbar>
      <Table head={['Пользователь', 'Статус', 'KYC', 'Риск', 'Баланс', 'Сделок', 'Последний вход', 'Создан']} loading={data.isLoading} empty={data.data?.items.length === 0}>
        {data.data?.items.map((u: any) => (
          <tr key={u.id} className="clickable" onClick={() => nav(`/users/${u.id}`)}>
            <td>
              <div className="font-semibold">{u.fullName ?? u.nickname ?? '—'}</div>
              <div className="mono muted">{u.phone}</div>
            </td>
            <td>
              <Tag v={u.status} />
            </td>
            <td>
              <Tag v={u.kycStatus} /> <Tag v={u.kycLevel} />
            </td>
            <td>
              <span className={`mono font-bold ${u.riskScore >= 70 ? 'text-red' : u.riskScore >= 40 ? 'text-yellow' : 'text-green'}`}>{u.riskScore}</span>
            </td>
            <td className="mono">
              {fmt(u.balance?.available)} {Number(u.balance?.locked) > 0 && <span className="muted">(+{fmt(u.balance.locked)} 🔒)</span>}
            </td>
            <td>{u.completedOrders}</td>
            <td className="muted">{dt(u.lastLoginAt)}</td>
            <td className="muted">{dt(u.createdAt)}</td>
          </tr>
        ))}
      </Table>
      {data.data && <Pager page={data.data.page} pages={data.data.pages ?? Math.ceil(data.data.total / data.data.limit)} total={data.data.total} onPage={setPage} />}
    </Page>
  );
}
