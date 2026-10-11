Java.perform(function () {
  var targetHost = 'api-akm.goodnovel.com';
  var targetPath = '/hwycclient/chapter/';
  var autoRequestedChapterIds = {};
  var autoRequestedBookDirectories = {};
  var detailBooksById = {};
  var freeChapterCallbackClass = null;
  var directoryCallbackClass = null;

  function emit(event) {
    send(JSON.stringify(event));
  }

  function decodeContent(content) {
    try {
      // JADX's renamed method maps to kv.j.G in the APK DEX.
      var decoderClass = Java.use('kv.j');
      var decoder = decoderClass.G.overload('java.lang.String');
      var decoded = decoder.call(decoderClass, String(content));
      if (decoded === null || String(decoded).length === 0 || String(decoded) === 'jysb') return null;
      return String(decoded);
    } catch (e) {
      emit({ type: 'chapter-content-decode-error', error: String(e) });
      return null;
    }
  }

  function chapterInfo(chapter, orderRequired) {
    if (chapter === null) return null;
    try {
      function read(name) {
        try {
          var clazz = chapter.getClass();
          var field = clazz.getField.overload('java.lang.String').call(clazz, name);
          return field.get.overload('java.lang.Object').call(field, chapter);
        } catch (_) {
          try {
            var getter = chapter['get' + name.charAt(0).toUpperCase() + name.slice(1)];
            return getter ? getter.call(chapter) : null;
          } catch (_) { return null; }
        }
      }
      var content = read('content');
      var preview = read('previewContent');
      var name = read('chapterName');
      var id = read('id');
      var bookId = read('bookId');
      var cachedBook = bookId === null ? null : detailBooksById[String(bookId)];
      var bookName = cachedBook === null || cachedBook === undefined ? null : readModelField(cachedBook, 'bookName');
      var charged = read('charged');
      var price = read('price');
      var output = {
        bookId: bookId === null ? null : String(bookId),
        bookName: bookName === null ? null : String(bookName),
        id: id === null ? null : String(id),
        name: name === null ? null : String(name),
        index: String(read('index')),
        wordCount: String(read('wordNum')),
        price: price === null ? null : String(price),
        contentLength: content === null ? 0 : String(content).length,
        previewLength: preview === null ? 0 : String(preview).length,
        charged: charged === null ? null : String(charged),
        orderRequired: orderRequired === null ? null : String(orderRequired),
        status: String(read('status')),
        previousChapterId: String(read('prevChapterId')),
        nextChapterId: String(read('nextChapterId'))
      };
      if (String(orderRequired).toLowerCase() === 'false' && Number(price) === 0 && content !== null && String(content).length > 0) {
        var decodedContent = decodeContent(content);
        if (decodedContent !== null) {
          output.plaintextLength = decodedContent.length;
          output.body = decodedContent;
        }
      }
      return output;
    } catch (e) {
      return { error: String(e) };
    }
  }

  function readModelField(model, name) {
    if (model === null) return null;
    try {
      var clazz = model.getClass();
      var field = clazz.getField.overload('java.lang.String').call(clazz, name);
      return field.get.overload('java.lang.Object').call(field, model);
    } catch (_) {
      try {
        var getter = model['get' + name.charAt(0).toUpperCase() + name.slice(1)];
        return getter ? getter.call(model) : null;
      } catch (_) { return null; }
    }
  }

  function javaString(value) {
    if (value === null || value === undefined) return null;
    try {
      return String(value.toString());
    } catch (_) {
      return String(value);
    }
  }

  function listFieldValues(value, itemField) {
    var result = [];
    if (value === null || value === undefined) return result;
    try {
      var list = Java.cast(value, Java.use('java.util.List'));
      for (var i = 0; i < list.size(); i++) {
        var item = list.get(i);
        var selected = itemField ? readModelField(item, itemField) : null;
        if (selected === null && itemField === 'name') selected = readModelField(item, 'desc');
        result.push(javaString(selected === null ? item : selected));
      }
    } catch (e) {
      emit({ type: 'book-detail-list-error', error: String(e) });
    }
    return result.filter(function (item) { return item !== null && item !== ''; });
  }

  function chapterArray(list, orderRequired) {
    var result = [];
    if (list === null) return result;
    try {
      var typedList = Java.cast(list, Java.use('java.util.List'));
      var count = Math.min(typedList.size(), 20);
      for (var i = 0; i < count; i++) result.push(chapterInfo(typedList.get(i), orderRequired));
    } catch (e) {
      try {
        var length = Math.min(list.length, 20);
        for (var j = 0; j < length; j++) result.push(chapterInfo(list[j], orderRequired));
      } catch (arrayError) {
        result.push({ error: String(e), arrayError: String(arrayError), runtimeType: String(list.getClass().getName()) });
      }
    }
    return result;
  }

  function requestFreeChaptersFromDetail(chapterListInfo, bookId) {
    try {
      if (chapterListInfo === null || !bookId) return;
      var chapters = readModelField(chapterListInfo, 'list');
      if (chapters === null) return;
      var typedList = Java.cast(chapters, Java.use('java.util.List'));
      var book = readModelField(chapterListInfo, 'book');
      if (book === null) book = detailBooksById[String(bookId)] || null;
      var bookManager = Java.use('com.read.goodnovel.db.manager.BookManager').getInstance();
      if (book === null) book = bookManager.findBookInfo.overload('java.lang.String').call(bookManager, String(bookId));
      if (book === null) {
        emit({ type: 'detail-auto-fetch-skipped', bookId: String(bookId), reason: 'book-not-in-local-database' });
        return;
      }

      if (freeChapterCallbackClass === null) {
        freeChapterCallbackClass = Java.registerClass({
          name: 'org.codex.goodnovel.FreeChapterCaptureCallback',
          implements: [Java.use('ps.j')],
          methods: {
            b: function (code, message) {
              emit({ type: 'detail-auto-fetch-error', code: Number(code), message: String(message) });
            },
            f: function (_) {},
            l: function (_) {},
            m: function (_) {},
            onStart: function () {},
            onStop: function () {}
          }
        });
      }
      var loader = Java.use('ps.l').f();
      var requestMethod = loader.h.overloads.filter(function (overload) {
        return overload.argumentTypes.length === 8;
      })[0];
      if (!requestMethod) throw new Error('chapter loader overload not found');

      var queued = 0;
      var ignoredPaid = 0;
      for (var i = 0; i < typedList.size() && queued < 20; i++) {
        var chapter = Java.cast(typedList.get(i), Java.use('com.read.goodnovel.db.entity.Chapter'));
        var chapterId = chapter.id.value === null ? '' : String(chapter.id.value);
        var price = Number(chapter.price.value);
        if (!chapterId || Number(chapterId) <= 0) continue;
        if (price !== 0) {
          ignoredPaid++;
          continue;
        }
        var key = String(bookId) + ':' + chapterId;
        if (autoRequestedChapterIds[key]) continue;
        autoRequestedChapterIds[key] = true;
        requestMethod.call(loader, book, chapter, false, false, false, 'BOOK_DETAIL_AUTO_CAPTURE', false, freeChapterCallbackClass.$new());
        queued++;
      }
      emit({
        type: 'detail-auto-fetch-queued',
        bookId: String(bookId),
        queuedFreeChapters: queued,
        ignoredNonFreeChapters: ignoredPaid,
        maxPerDetailOpen: 20
      });
    } catch (e) {
      emit({ type: 'detail-auto-fetch-error', bookId: String(bookId || ''), error: String(e), stack: String(e.stack || '') });
    }
  }

  function requestChapterDirectory(bookId) {
    try {
      bookId = String(bookId || '');
      if (!bookId || autoRequestedBookDirectories[bookId]) return;
      autoRequestedBookDirectories[bookId] = true;
      if (directoryCallbackClass === null) {
        directoryCallbackClass = Java.registerClass({
          name: 'org.codex.goodnovel.FreeChapterDirectoryCallback',
          superClass: Java.use('at.a'),
          fields: { bookId: 'java.lang.String' },
          methods: {
            c: function (response) {
              requestFreeChaptersFromDetail(response, this.bookId.value);
            },
            b: function (code, message) {
              emit({ type: 'detail-auto-directory-error', code: Number(code), message: String(message) });
            }
          }
        });
      }
      var callback = directoryCallbackClass.$new();
      callback.bookId.value = bookId;
      var requestDirectoryClass = Java.use('at.l');
      var requestDirectory = requestDirectoryClass.r.overload('java.lang.String', 'int', 'long', 'boolean', 'at.a');
      requestDirectory.call(requestDirectoryClass, bookId, 100, -1, true, callback);
      emit({ type: 'detail-auto-directory-requested', bookId: bookId, chapterCount: 100 });
    } catch (e) {
      emit({ type: 'detail-auto-directory-error', bookId: String(bookId || ''), error: String(e), stack: String(e.stack || '') });
    }
  }

  function inspectResponse(value, source) {
    if (value === null) return;
    var className = String(value.getClass().getName());
    emit({ type: 'response-model-seen', source: source, model: className });
    if (className === 'com.lib.http.model.BaseEntity') {
      var BaseEntity = Java.use('com.lib.http.model.BaseEntity');
      value = Java.cast(value, BaseEntity).getData();
      if (value === null) return;
      className = String(value.getClass().getName());
      emit({ type: 'response-data-model-seen', source: source, model: className });
    }
    if (className === 'com.read.goodnovel.model.BookDetailInfo' && String(source) === 'Retrofit Gson converter') {
      var detailBook = readModelField(value, 'book');
      var detailBookId = detailBook === null ? null : readModelField(detailBook, 'bookId');
      if (detailBook !== null && detailBookId !== null) {
        detailBooksById[String(detailBookId)] = detailBook;
        var bookFields = [
          'bookId', 'bookName', 'pseudonym', 'introduction',
          'cover', 'bookDetailCover', 'language', 'languageDisplay',
          'chapterCount', 'totalCatalog', 'totalWords', 'bookStatus',
          'writeStatus', 'ratings', 'viewCountDisplay', 'lastChapterName',
          'lastUpdateTimeDisplay', 'status'
        ];
        var bookInfo = {};
        for (var fieldIndex = 0; fieldIndex < bookFields.length; fieldIndex++) {
          var fieldName = bookFields[fieldIndex];
          var fieldValue = readModelField(detailBook, fieldName);
          if (fieldValue === null) continue;
          bookInfo[fieldName] = javaString(fieldValue);
        }
        var author = readModelField(value, 'author');
        if (author !== null) {
          var authorId = readModelField(author, 'id');
          if (authorId === null || javaString(authorId) === '0') authorId = readModelField(author, 'uid');
          var authorIdText = javaString(authorId);
          if (authorIdText !== null && authorIdText !== '' && authorIdText !== '0') bookInfo.authorId = authorIdText;
          var authorName = readModelField(author, 'pseudonym') || readModelField(author, 'nickname');
          if (authorName !== null) bookInfo.authorName = javaString(authorName);
          var authorAvatar = readModelField(author, 'avatar');
          if (authorAvatar !== null) bookInfo.authorAvatar = javaString(authorAvatar);
        }
        if (bookInfo.authorId === undefined) {
          var fallbackAuthorId = readModelField(detailBook, 'authorId');
          var fallbackAuthorIdText = javaString(fallbackAuthorId);
          if (fallbackAuthorIdText !== null && fallbackAuthorIdText !== '' && fallbackAuthorIdText !== '0') {
            bookInfo.authorId = fallbackAuthorIdText;
          }
        }
        bookInfo.genreNames = listFieldValues(readModelField(detailBook, 'genreNames'), null);
        var labels = listFieldValues(readModelField(detailBook, 'labels'), 'name');
        if (labels.length === 0) labels = listFieldValues(readModelField(detailBook, 'labelObjects'), 'name');
        bookInfo.labels = labels;
        emit({ type: 'book-detail-info', bookId: String(detailBookId), book: bookInfo });
        requestChapterDirectory(detailBookId);
      }
    } else if (className === 'com.read.goodnovel.model.ChapterOrderInfo') {
      var order = Java.cast(value, Java.use(className));
      var status = readModelField(order, 'status');
      var needLogin = readModelField(order, 'needLogin');
      var needOrder = readModelField(order, 'needOrder');
      var indexChapter = readModelField(order, 'indexChapter');
      var chapters = readModelField(order, 'list');
      if (String(source).indexOf('BOOK_DETAIL_AUTO_CAPTURE') >= 0 && String(needOrder).toLowerCase() === 'true') {
        emit({
          type: 'detail-auto-fetch-paywall',
          source: source,
          needOrder: String(needOrder),
          indexChapter: chapterInfo(indexChapter, needOrder)
        });
      }
      emit({
        type: 'chapter-response-model',
        source: source,
        model: className,
        status: status === null ? null : String(status),
        needLogin: needLogin === null ? null : String(needLogin),
        needOrder: needOrder === null ? null : String(needOrder),
        indexChapter: chapterInfo(indexChapter, needOrder),
        list: chapterArray(chapters, needOrder)
      });
    } else if (className === 'com.read.goodnovel.model.ChapterListInfo') {
      if (String(source) === 'Retrofit Gson converter') {
        var listBook = readModelField(value, 'book');
        var listBookId = listBook === null ? null : readModelField(listBook, 'bookId');
        if (listBookId === null) {
          var responseChapters = readModelField(value, 'list');
          if (responseChapters !== null) {
            try {
              var responseChapterList = Java.cast(responseChapters, Java.use('java.util.List'));
              if (responseChapterList.size() > 0) listBookId = readModelField(responseChapterList.get(0), 'bookId');
            } catch (e) {
              emit({ type: 'detail-auto-fetch-error', error: String(e), phase: 'resolve-book-id' });
            }
          }
        }
        if (listBookId !== null) requestFreeChaptersFromDetail(value, String(listBookId));
      }
      emit({ type: 'chapter-list-model', source: source, model: className, chapters: chapterArray(readModelField(value, 'list'), null) });
    }
  }

  try {
    var RequestConverter = Java.use('retrofit2.converter.gson.GsonRequestBodyConverter');
    var convertRequest = RequestConverter.convert.overload('java.lang.Object');
    convertRequest.implementation = function (input) {
      if (input !== null) {
        try {
          var requestMap = Java.cast(input, Java.use('java.util.Map'));
          var chapterIds = requestMap.get('chapterIds');
          if (chapterIds !== null) {
            emit({
              type: 'chapter-request-body',
              bookId: String(requestMap.get('bookId')),
              chapterIds: String(chapterIds),
              autoPay: String(requestMap.get('autoPay')),
              confirmPay: String(requestMap.get('confirmPay')),
              offset: String(requestMap.get('offset')),
              source: String(requestMap.get('source')),
              preLoad: String(requestMap.get('preLoad')),
              viewAd: String(requestMap.get('viewAd'))
            });
          }
        } catch (e) {
          emit({ type: 'request-body-hook-error', error: String(e), stack: String(e.stack || '') });
        }
      }
      return convertRequest.call(this, input);
    };
    emit({ type: 'hook-ready', hook: 'Retrofit chapter request metadata' });
  } catch (e) {
    emit({ type: 'hook-error', hook: 'Retrofit request converter', error: String(e) });
  }

  try {
    var ResponseConverter = Java.use('retrofit2.converter.gson.GsonResponseBodyConverter');
    var convertResponse = ResponseConverter.convert.overload('okhttp3.ResponseBody');
    convertResponse.implementation = function (body) {
      var response = convertResponse.call(this, body);
      try {
        inspectResponse(response, 'Retrofit Gson converter');
      } catch (e) {
        emit({ type: 'response-converter-hook-error', error: String(e), stack: String(e.stack || '') });
      }
      return response;
    };
    emit({ type: 'hook-ready', hook: 'Retrofit chapter response model' });
  } catch (e) {
    emit({ type: 'hook-error', hook: 'Retrofit response converter', error: String(e) });
  }

  try {
    var Request = Java.use('okhttp3.Request');
    var requestCtor = Request.$init.overload(
      'okhttp3.HttpUrl',
      'java.lang.String',
      'okhttp3.Headers',
      'okhttp3.RequestBody',
      'java.util.Map'
    );
    requestCtor.implementation = function (url, method, headers, body, tags) {
      var result = requestCtor.call(this, url, method, headers, body, tags);
      try {
        var requestUrl = String(url.toString());
        if (requestUrl.indexOf(targetHost) >= 0 && requestUrl.indexOf(targetPath) >= 0) {
          emit({ type: 'chapter-request', url: requestUrl, method: String(method) });
        }
      } catch (e) {
        emit({ type: 'request-hook-error', error: String(e) });
      }
      return result;
    };
    emit({ type: 'hook-ready', hook: 'OkHttp request URL' });
  } catch (e) {
    emit({ type: 'hook-error', hook: 'OkHttp request', error: String(e) });
  }

  try {
    var Gson = Java.use('com.google.gson.Gson');
    var overloads = Gson.fromJson.overloads;
    for (var j = 0; j < overloads.length; j++) {
      (function (overload) {
        overload.implementation = function () {
          var parsed = overload.apply(this, arguments);
          var value = parsed;
          try {
            if (value !== null) {
              inspectResponse(value, 'Gson.fromJson');
            }
          } catch (e) {
            emit({ type: 'response-model-hook-error', error: String(e) });
          }
          return parsed;
        };
      })(overloads[j]);
    }
    emit({ type: 'hook-ready', hook: 'Gson chapter response models', overloadCount: overloads.length });
  } catch (e) {
    emit({ type: 'hook-error', hook: 'Gson response models', error: String(e) });
  }

  emit({ type: 'hook-ready', hook: 'book-detail auto chapter directory' });
});
