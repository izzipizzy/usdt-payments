import {Heading, Screenshot, Stage, Tag} from '../ui';
export const Deposits = () => <Stage chapter="03 / УВИДЕТЬ ПОСТУПЛЕНИЕ">
  <Heading eyebrow="УЧЁТ ПОСТУПЛЕНИЙ" title={<>Каждый платёж<br/>на виду.</>} detail="Адрес, сумма, статус и ссылка на транзакцию — в одной истории." />
  <Screenshot file="deposits.ru.png" caption="Подтверждённое поступление" position="50% 0%" />
  <Tag>Обнаружение подтверждённых переводов</Tag>
</Stage>;
