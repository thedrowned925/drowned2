# Drowned2 — Steam'den Kurulu Oyun Yedekleri

`drowned2`, `drowned1` içindeki **Drowned Distribution Suite** altyapısının ayrı ve temiz bir kopyasıdır. `drowned1` içindeki mevcut oyun katalogları, manifestleri, artwork dosyaları ve Release verileri buraya taşınmaz; `drowned2` kendi kataloğunu sıfırdan oluşturur.

## Ana akış

### 1. Yedekleme

1. Oyunu **Steam istemcisinden normal şekilde indirirsin**.
2. `Drowned2 Release Manager` içinde oyunun kurulu klasörünü seçersin.
3. Sistem Steam kurulumunu otomatik tanır ve `appmanifest_<appid>.acf` üzerinden AppID, oyun adı ve build ID gibi yerel bilgileri okur.
4. Steam Store/CDN katmanı mümkün olan metadata ve artwork dosyalarını getirir.
5. Yedeklemeyi/yayınlamayı **sen manuel olarak başlatırsın**.
6. Balanced Direct Stream oyunu geçici dev arşiv oluşturmadan GitHub Release assetlerine chunk olarak yükler.
7. Aynı işlem manifesti ve `catalog.json` kaydını üretir.

```text
Steam'den senin indirdiğin oyun
  -> oyun klasörünü seç
  -> Steam AppID otomatik algıla
  -> Steam metadata + artwork otomatik çek
  -> sen Yayınla / Yedekle de
  -> Balanced Direct Stream
  -> GitHub Release chunk assetleri
  -> manifest + catalog.json
```

### 2. Geri yükleme / Launcher

`windows/launcher/app_drowned2.py`, mevcut v16 Launcher arayüzünü ve Drowned indirme altyapısını kullanan Drowned2'ye özel giriş noktasıdır. Kaynak sabit olarak `thedrowned925/drowned2@main` kullanılır; Drowned1 Launcher ayarları Drowned2'yi başka repoya yönlendiremez.

Launcher akışı:

```text
Drowned2 Launcher
  -> catalog.json
  -> oyunu seç
  -> manifesti oku
  -> kurulum klasörünü seç
  -> GitHub Release chunklarını indir
  -> manifest segmentlerine göre byte'ları doğrudan final oyun dosyalarına yaz
  -> SHA-256 doğrula
  -> kurulumu kaydet
```

Launcher büyük chunk dosyalarını kalıcı bir ara arşiv olarak saklamaz. İndirilen veriler manifestteki `file`, `file_offset`, `chunk_offset` ve `length` eşlemesine göre doğrudan hedef oyun dosyalarının doğru offsetlerine yazılır.

Mevcut indirme altyapısı şunları destekler:

- en fazla 16 eşzamanlı HTTP stream
- GitHub Release assetlerinde HTTP Range kullanımı
- bir chunk içinde birden fazla Range stream
- duraklatma / devam ettirme / iptal
- `.drowned/state.json` ile tamamlanan chunkların takibi ve yarım indirmeye devam
- kurulum sonunda SHA-256 doğrulaması
- **Dosyaları Doğrula** ile eksik/değişmiş dosyaları bulma
- onarımda yalnız bozuk dosyalara temas eden chunkları yeniden indirme
- kurulu oyun sürümünü ve klasörünü hatırlama
- yeni catalog sürümünde `GÜNCELLE` durumuna geçme
- güvenli kaldırma akışı
- İndirmeler sayfası ve Big Picture / gamepad arayüzü

`Drowned2 Launcher` uygulama adı kullandığı için AppData içindeki katalog cache'i ve kurulu oyun kayıtları eski Drowned1 Launcher'dan ayrı tutulur.

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

- **`windows/release-manager/app_steam.py`** — Drowned2 için Steam otomatik algılamalı Release Manager.
- **`windows/launcher/app_drowned2.py`** — Drowned2'ye sabitlenmiş ana Launcher; v16 arayüzünü ve mevcut install/repair altyapısını kullanır.
- **`shared/python/drowned_shared/install.py`** — chunk indirme, Range, doğrudan final dosyaya yazma, resume, SHA-256 doğrulama ve repair altyapısı.
- **`web/`** — daha önce denenen tek dosya File Explorer arayüzü. Bu özellik şimdilik ikincil/park edilmiş durumdadır; ana geri yükleme yolu Launcher'dır.
- **`.github/workflows/extract-file.yml`** — web tek dosya denemesinin workflow'u; ana Launcher akışı bunu kullanmaz.
- **`tests`** — Drowned protokol, upload/download, repair, Steam algılama ve Launcher yapı testleri.

## Büyük dosya / yedekleme mantığı

Büyük oyun dosyaları normal Git history içine yazılmaz. Release Manager kaynak klasörü doğrudan stream eder; Balanced Direct Stream planı dosyaları adaptif chunk'lara ayırır ve GitHub Release Assets olarak yükler.

Launcher geri yükleme sırasında chunkları tekrar tek bir geçici arşivde birleştirmez. Örneğin 50 GB'lık bir oyun dosyası birden fazla Release chunkına yayılıyorsa, Launcher gelen byte'ları doğrudan o 50 GB final dosyanın ilgili konumlarına yazar. Bu nedenle GitHub Actions runner diskine veya yeniden oluşturulmuş tek bir Release assetine ihtiyaç yoktur.

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

- `.github/workflows/build-steam-backup.yml` — `app_steam.py` için **Drowned2-Release-Manager** build'i.
- `.github/workflows/build-windows.yml` — Drowned2 Launcher'ı **Drowned2-Launcher** adıyla Windows için build eder, protokol testlerini çalıştırır, PyInstaller paketini kontrol eder ve uygulamayı smoke-test eder.

Başarılı Windows build sonunda Actions artifact olarak `Drowned2-Launcher-Windows` oluşur.

## Yetkiler

Release Manager için kullanılan fine-grained PAT yalnızca bu repository'ye erişecek şekilde sınırlandırılabilir ve en az `Contents: Read and write` iznine sahip olmalıdır. Token kaynak koda yazılmaz; mevcut Drowned güvenli saklama yöntemi kullanılmaya devam eder.

Public `drowned2` kataloğunu ve Release assetlerini okumak için Launcher tarafında GitHub token gerekmez.

## Başlangıç durumu

`catalog.json` boş bir `games` dizisiyle başlatılmıştır. İlk oyun sen tarafından yayınlandığında Release Manager katalog, manifest ve artwork alanlarını otomatik doldurur; Launcher yenilemede oyunu görür.

Altyapı kaynağı: `thedrowned925/drowned1`  
Hedef yedek repository'si: `thedrowned925/drowned2`
