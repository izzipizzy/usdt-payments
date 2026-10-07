import {C, Stage} from '../ui';
export const Operations = () => <Stage chapter="07 / ЗАПУСТИТЬ У СЕБЯ">
  <div style={{position: 'absolute', left: 104, top: 220, fontSize: 23, color: C.green, fontWeight: 700, letterSpacing: 3}}>КОНТРОЛЬ И ВОССТАНОВЛЕНИЕ</div>
  <div style={{position: 'absolute', left: 99, top: 285, fontSize: 100, fontWeight: 700, letterSpacing: -4}}>Готово к вашему запуску.</div>
  <div style={{position: 'absolute', left: 104, top: 466, display: 'flex', gap: 26}}>
    <div style={{background: '#14372b', border: '1px solid #426b55', borderRadius: 28, width: 482, padding: 35}}><div style={{fontSize: 66, color: C.green, fontWeight: 700}}>2FA</div><div style={{fontSize: 31, marginTop: 14}}>Пароль + аутентификатор</div></div>
    <div style={{background: '#14372b', border: '1px solid #426b55', borderRadius: 28, width: 482, padding: 35}}><div style={{fontSize: 66, color: C.green, fontWeight: 700}}>Свои ключи</div><div style={{fontSize: 31, marginTop: 14}}>Изолированный подписант</div></div>
    <div style={{background: '#14372b', border: '1px solid #426b55', borderRadius: 28, width: 482, padding: 35}}><div style={{fontSize: 66, color: C.green, fontWeight: 700}}>7 копий</div><div style={{fontSize: 31, marginTop: 14}}>Ежедневный полный бэкап</div></div>
  </div>
  <div style={{position: 'absolute', left: 104, top: 786, fontSize: 38, color: C.yellow, fontWeight: 700}}>github.com/izzipizzy/usdt-payments</div>
</Stage>;
