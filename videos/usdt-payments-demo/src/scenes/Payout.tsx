import {C, Node, Route, Stage} from '../ui';
export const Payout = () => <Stage chapter="06 / ОТПРАВИТЬ ВЫПЛАТУ">
  <div style={{position: 'absolute', left: 104, top: 220, fontSize: 23, fontWeight: 700, color: C.green, letterSpacing: 3}}>ВЫПЛАТА В ДВА ЭТАПА</div>
  <div style={{position: 'absolute', left: 99, top: 278, fontSize: 96, fontWeight: 700, letterSpacing: -4}}>Укажите сумму и получателя.</div>
  <div style={{position: 'absolute', left: 104, top: 410, fontSize: 34, color: C.muted}}>Отдельный промежуточный адрес создаётся автоматически.</div>
  <Node label="Основной кошелёк" subtitle="Собранные USDT" x={104} active />
  <Route left={588} start={1.5} />
  <Node label="Промежуточный" subtitle="Один адрес на выплату" x={720} active />
  <Route left={1202} start={4} />
  <Node label="Получатель" subtitle="Адрес из вашей заявки" x={1336} />
  <div style={{position: 'absolute', left: 104, top: 780, fontSize: 30, color: C.green}}>Уникальный номер заявки защищает от повторного создания выплаты.</div>
</Stage>;
