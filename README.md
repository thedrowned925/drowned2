# Drowned2 — Steam Game Backup

`drowned2`, `drowned1` içindeki **Drowned Distribution Suite** altyapısının Steam oyun yedekleri için ayrılmış kopyasıdır.

Bu repository'de yalnızca **Steam üzerinden indirilmiş oyunların kişisel yedekleri** tutulacaktır. `drowned1` içindeki mevcut oyun katalogları, manifestleri, artwork dosyaları ve release verileri buraya taşınmaz; katalog temiz başlar.

## İçerik

- **Drowned Release Manager** — oyun klasörünü GitHub Release assetlerine parçalayıp yükler, manifest ve katalog üretir.
- **Drowned Launcher** — `catalog.json` ve manifestleri okuyup oyunları indirir, SHA-256 doğrulaması yapar ve dosyaları final konumlarına yazar.
- **shared/python** — launcher ve release manager'ın ortak Python kodu.
- **tests** — ortak altyapı testleri.
- **GitHub Actions** — Windows uygulamalarını/testleri build eden ve oyun listesini güncelleyen workflow'lar.

## Dağıtım akışı

Büyük oyun dosyaları normal Git history içine yazılmaz. Release Manager kaynak klasörü stream ederek yaklaşık **1900 MiB** parçalar üretir ve GitHub Release Assets olarak yükler.

```text
Steam oyun klasörü
  -> streaming chunk
  -> SHA-256
  -> GitHub draft release
  -> chunk assets
  -> manifest.json
  -> catalog.json
  -> publish
```

Launcher chunk dosyalarını kalıcı arşiv olarak tutmak yerine manifestteki segment haritasına göre final dosyaların doğru offsetlerine yazar.

## Metadata yapısı

```text
artwork/<platform>/<game-id>/hero.*
artwork/<platform>/<game-id>/cover.*
artwork/<platform>/<game-id>/logo.*
manifests/<platform>/<game-id>/<channel>/<version>.json
catalog.json
game-list.md
```

Metadata mümkün olduğunca `raw.githubusercontent.com` üzerinden, büyük içerikler ise GitHub Releases üzerinden okunur. Kopyalanan kod içindeki repository referansları `thedrowned925/drowned2` olarak güncellenmiştir.

## Steam-only kuralı

Bu repository'ye Release Manager ile eklenen oyunların kaynağı Steam olmalıdır. Steam dışındaki oyun yedekleri `drowned1` veya başka bir repository'de tutulmalıdır.

## Yetkiler

Release Manager için kullanılan fine-grained PAT yalnızca bu repository'ye erişmeli ve en az:

- `Contents: Read and write`
- `Workflows: Read and write` (workflow dosyaları güncellenecekse)

izinlerine sahip olmalıdır. Token kaynak koda yazılmaz; Windows Credential Manager/keyring üzerinden saklanır.

## Başlangıç durumu

`catalog.json` boş bir `games` dizisiyle başlatılmıştır. `artwork/`, `manifests/` ve `.build-status/` klasörleri de temizdir. İlk Steam oyunu yayınlandığında sistem bunları otomatik olarak dolduracaktır.

## Kaynak

Altyapı kaynağı: `thedrowned925/drowned1`  
Bu kopyanın repository hedefi: `thedrowned925/drowned2`
