# Drowned2 Range Proxy

Bu Worker oyun verisini saklamaz. Yalnızca `thedrowned925/drowned2` GitHub Release chunk assetleri için izin verilen byte aralıklarını geçirir.

## Neden gerekli?

GitHub Pages statik bir uygulamadır. Dosya gezgini manifestteki `chunk_offset` / `length` değerlerini okuyup yalnızca gereken byte aralıklarını ister. Browser CORS sınırı nedeniyle Release asset istekleri bu küçük Worker üzerinden geçirilir.

## Güvenlik modeli

- Yalnızca `thedrowned925/drowned2` kabul edilir.
- Yalnızca `chunk-000001.bin` biçimindeki asset adları kabul edilir.
- Tek istekte en fazla 64 MiB geçer.
- Web istemcisi 32 MiB dilimler kullanır.
- `ACCESS_KEY` tanımlanırsa her `/range` isteği `X-Drowned-Key` başlığıyla aynı anahtarı vermek zorundadır.
- Anahtar GitHub reposuna veya Pages çıktısına yazılmaz; kullanıcı web arayüzündeki Ayarlar ekranında bir kere girer ve yalnızca browser localStorage içinde tutulur.

## Cloudflare ile yayınlama

Cloudflare hesabında Wrangler kullanarak `worker/` klasöründen:

```bash
npx wrangler deploy
npx wrangler secret put ACCESS_KEY
```

İkinci komutta yalnızca senin bileceğin uzun bir anahtar gir.

Worker URL örneği:

```text
https://drowned2-range-proxy.<hesap>.workers.dev
```

GitHub Pages üzerindeki Drowned2 File Explorer > Ayarlar bölümüne Worker URL'sini ve aynı ACCESS_KEY değerini gir.

## Kontrol

```text
GET https://<worker-url>/health
```

`drowned2-range-proxy: ok` dönmelidir.

`/range` uç noktası `owner`, `repo`, `tag`, `asset`, `start`, `end` parametrelerini alır. Worker GitHub'a gerçek `Range: bytes=start-end` isteğini yollar ve GitHub `206 Partial Content` döndürmezse isteği reddeder. Böylece yanlışlıkla bütün chunk'ın indirilmesi engellenir.
