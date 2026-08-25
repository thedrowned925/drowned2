# Drowned2 — Steam'den Kurulu Oyun Yedekleri

`drowned2`, `drowned1` içindeki **Drowned Distribution Suite** altyapısının ayrı ve temiz bir kopyasıdır. `drowned1` içindeki mevcut oyun katalogları, manifestleri, artwork dosyaları ve Release verileri buraya taşınmaz; `drowned2` kendi kataloğunu sıfırdan oluşturur.

## Kullanım mantığı

Steam oyunu Drowned2 üzerinden indirilmez. Akış şu şekildedir:

1. Oyunu **Steam istemcisinden sen normal şekilde indirirsin**.
2. `Drowned2 Release Manager` içinde oyunun kurulu klasörünü seçersin.
3. Klasör seçilir seçilmez sistem Steam kurulumunu otomatik tanır.
4. `appmanifest_<appid>.acf` ile klasör eşleştirilir ve **Steam AppID** otomatik bulunur.
5. Oyun adı ve Steam build ID yerel manifestten okunur.
6. Drowned1'de zaten bulunan Steam Store/CDN katmanı otomatik çalıştırılır ve mümkün olan metadata alınır:
   - oyun adı
   - açıklama
   - hero
   - cover
   - logo
   - icon
   - ekran görüntüleri
   - fragman bağlantıları
7. Yedeklemeyi/yayınlamayı **sen manuel olarak başlatırsın**.
8. Drowned1 ile aynı Balanced Direct Stream sistemi klasörü geçici dev arşiv oluşturmadan GitHub Release assetlerine yükler ve manifest + `catalog.json` üretir.

```text
Steam'den senin indirdiğin oyun
  -> oyun klasörünü seç
  -> Steam AppID otomatik algıla
  -> Steam metadata + artwork otomatik çek
  -> sen Yayınla / Yedekle de
  -> Balanced Direct Stream
  -> GitHub Release Assets
  -> manifest + catalog.json
```

## Steam klasörü nasıl tanınıyor?

`shared/python/drowned_shared/steam_detect.py` aşağıdaki kaynakları kullanır:

- seçilen klasörün `steamapps/common/<oyun>` ilişkisi
- `appmanifest_<appid>.acf` içindeki `appid`, `name`, `installdir`, `buildid`, `LastUpdated`
- varsa `steam_appid.txt`
- Windows Registry'deki Steam kurulum yolu
- `libraryfolders.vdf` içindeki ek Steam Library klasörleri
- oyunun ana klasörünün içindeki bir alt klasörün seçilmesi

Steam eşleşmesi bulunamazsa mevcut Drowned mantığı bozulmaz; klasör yine seçilmiş kalır ve metadata elle girilerek yedekleme yapılabilir.

## Uygulamalar

- **`windows/release-manager/app_steam.py`** — Drowned2 için Steam otomatik algılamalı ana Release Manager giriş noktası.
- **Drowned Release Manager altyapısı** — oyun klasörünü GitHub Release assetlerine stream eder, manifest ve katalog üretir.
- **Drowned Launcher** — `catalog.json` ve manifestleri okuyup yedekleri indirir, SHA-256 doğrulaması yapar ve dosyaları final konumlarına yazar.
- **`web/`** — GitHub Pages üzerinde oyunları klasör klasör gezen ve tek dosya indirebilen web arayüzü.
- **`worker/`** — yalnızca `thedrowned925/drowned2` Release chunk'larının izin verilen byte aralıklarını geçiren Cloudflare Worker.
- **`shared/python`** — chunking, install, GitHub client, metadata, Steam artwork ve doğrulama altyapısı.
- **`tests`** — Drowned1 testleri + Steam klasör algılama testleri.

## Büyük dosya / yedekleme mantığı

Büyük oyun dosyaları normal Git history içine yazılmaz. Release Manager kaynak klasörü doğrudan stream eder; Balanced Direct Stream planı dosyaları adaptif chunk'lara ayırır ve GitHub Release Assets olarak yükler.

Launcher chunk dosyalarını kalıcı arşiv olarak tutmak yerine manifestteki segment haritasına göre final dosyaların doğru offsetlerine yazar ve SHA-256 doğrulaması yapar.

## Web File Explorer — tek dosya erişimi

Web arayüzü mevcut chunk formatını değiştirmez. Manifestte zaten bulunan:

```text
file
file_offset
chunk_offset
length
```

segment haritasını kullanır. Bir dosya seçildiğinde sadece o dosyanın bulunduğu chunk byte aralıkları istenir. İstemci büyük segmentleri 32 MiB Range isteklerine böler ve Chrome/Edge üzerinde File System Access API kullanarak gelen veriyi doğrudan seçilen dosyaya yazar. Böylece büyük bir dosyanın tamamı RAM içinde tutulmaz ve oyunun geri kalanı indirilmez.

Akış:

```text
GitHub Pages File Explorer
  -> catalog + manifest oku
  -> seçilen dosyanın segmentlerini bul
  -> 32 MiB byte range istekleri
  -> Drowned2 Range Worker
  -> GitHub Release chunk asset
  -> yalnız gerekli byte'lar
  -> kullanıcının seçtiği dosyaya stream et
```

`worker/src/index.js` yalnızca `thedrowned925/drowned2`, `chunk-XXXXXX.bin` biçimindeki assetler ve en fazla 64 MiB'lık tekil Range isteklerine izin verir. `ACCESS_KEY` tanımlandığında web arayüzündeki anahtar ile Worker anahtarının eşleşmesi gerekir.

GitHub Pages deployment workflow'u `.github/workflows/pages.yml` içindedir. Repository için Pages ilk kez **Settings > Pages > Build and deployment > Source: GitHub Actions** olarak etkinleştirildikten sonra `web/`, `catalog.json`, `manifests/` veya `artwork/` değiştiğinde site otomatik yeniden yayınlanır.

Worker kurulumu için `worker/README.md` dosyasına bak.

## Metadata yapısı

```text
artwork/<platform>/<game-id>/hero.*
artwork/<platform>/<game-id>/cover.*
artwork/<platform>/<game-id>/logo.*
artwork/<platform>/<game-id>/icon.*
artwork/<platform>/<game-id>/screenshots/*
manifests/<platform>/<game-id>/<channel>/<version>.json
catalog.json
game-list.md
```

## Windows build

`.github/workflows/build-steam-backup.yml`, `app_steam.py` sürümünü Windows için **Drowned2-Release-Manager** olarak build eder ve GitHub Actions artifact'ı üretir. Aynı workflow önce Steam algılama testlerini ve mevcut Drowned test paketini çalıştırır.

## Yetkiler

Release Manager için kullanılan fine-grained PAT yalnızca bu repository'ye erişecek şekilde sınırlandırılabilir ve en az `Contents: Read and write` iznine sahip olmalıdır. Token kaynak koda yazılmaz; mevcut Drowned güvenli saklama yöntemi kullanılmaya devam eder.

## Başlangıç durumu

`catalog.json` boş bir `games` dizisiyle başlatılmıştır. `artwork/`, `manifests/` ve `.build-status/` temizdir. İlk oyun sen tarafından yayınlandığında sistem bunları otomatik doldurur.

Altyapı kaynağı: `thedrowned925/drowned1`  
Hedef yedek repository'si: `thedrowned925/drowned2`
