import {BasicCaptions} from './basic-captions';
import {useVideoConfig} from 'remotion';

export const Captions = () => {
 const {fps}=useVideoConfig();
 return <div className="video-captions" style={{position:'absolute',left:240,bottom:110,width:1440}}>
 <style>{`.video-captions > div > div {font-size:42px !important;background:rgba(5,20,16,.9) !important;border-radius:14px;}`}</style>
 <BasicCaptions name="Русские субтитры" width={1440} premountFor={fps} combineTokensWithinMilliseconds={0} captions={[
  {
    "text": " usdt-payments. Приём и выплаты в сети TRON. На вашем сервере.",
    "startMs": 700,
    "endMs": 6623,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Для каждого счёта создайте отдельный адрес и передайте его",
    "startMs": 8700,
    "endMs": 12114,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " клиенту. Для постоянного клиента можно использовать один адрес",
    "startMs": 12114,
    "endMs": 16555,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " повторно. Оплата — USDT в сети TRON.",
    "startMs": 16555,
    "endMs": 20486,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Сканер обнаруживает подтверждённый перевод. В админке видно, кто",
    "startMs": 22700,
    "endMs": 27349,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " заплатил, сколько пришло и на какой адрес. Поступления сохраняются",
    "startMs": 27349,
    "endMs": 31979,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " в истории.",
    "startMs": 31979,
    "endMs": 32692,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Средства автоматически собираются на основной кошелёк: по сумме",
    "startMs": 34700,
    "endMs": 38051,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " или времени. Сбор можно запустить вручную. Статус и транзакция",
    "startMs": 38051,
    "endMs": 43508,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " видны в админке.",
    "startMs": 43508,
    "endMs": 44459,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Пул с TRX оплачивает сетевые расходы. Подключите аренду энергии",
    "startMs": 46700,
    "endMs": 51569,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " через itrx. Автопополнение переводит нужную сумму из пула в",
    "startMs": 51569,
    "endMs": 55840,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " сервис.",
    "startMs": 55840,
    "endMs": 56437,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Для выплаты укажите адрес получателя, сумму и номер заявки. Сервис",
    "startMs": 58700,
    "endMs": 63882,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " выделяет промежуточный адрес и выполняет перевод в два этапа.",
    "startMs": 63882,
    "endMs": 67315,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Повтор номера не создаёт новую выплату.",
    "startMs": 68060,
    "endMs": 70498,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " Ключи хранит отдельный подписант. Вход защищён паролем и",
    "startMs": 72700,
    "endMs": 76885,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " аутентификатором. При установке включается ежедневный бэкап: семь",
    "startMs": 76885,
    "endMs": 81120,
    "timestampMs": null,
    "confidence": null
  },
  {
    "text": " копий. Исходники — на GitHub.",
    "startMs": 81120,
    "endMs": 83978,
    "timestampMs": null,
    "confidence": null
  }
]} />
 </div>;
};
