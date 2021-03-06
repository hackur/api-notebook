/* global describe, it, beforeEach, afterEach, before, after */

describe('RAML Client Generator Plugin', function () {
  var fixture              = document.getElementById('fixture');
  var methodsWithoutBodies = ['get', 'head'];
  var methodsWithBodies    = ['post', 'put', 'patch', 'delete'];
  var methods              = methodsWithBodies.concat(methodsWithoutBodies);
  var sandbox;

  before(function () {
    sandbox = new App.Sandbox();
    App.middleware.register(ramlClientGeneratorPlugin);
  });

  after(function () {
    sandbox.remove();
    App.middleware.deregister(ramlClientGeneratorPlugin);
  });

  it('should augment execution context with an `API` method', function (done) {
    sandbox.execute('API', function (err, exec) {
      expect(exec.result).to.be.an('object');
      return done();
    });
  });

  ['/base-version.raml', '/version10/base-version.raml'].forEach(function (path) {
    describe('Base URI Version', function () {
      var server;

      beforeEach(function (done) {
        sandbox.execute('API.createClient("baseVersion", "' + FIXTURES_URL + path + '");', function (err) {
          server = sinon.fakeServer.create();
          done(err);
        });
      });

      afterEach(function () {
        server.restore();
      });

      it('should inject the version into the base uri automatically', function (done) {
        server.respondWith('GET', 'http://example.com/v2/', [200, {
          'Content-Type': 'text/html'
        }, 'success']);

        sandbox.execute('baseVersion("/").get();', function (err, exec) {
          expect(exec.result.body).to.equal('success');
          expect(exec.result.status).to.equal(200);
          return done();
        });

        server.respond();
      });
    });
  });

  ['/base-uri-parameters.raml', '/version10/base-uri-parameters.raml'].forEach(function (path) {
    describe('Base URI Parameters', function () {
      var server;

      beforeEach(function (done) {
        sandbox.execute('API.createClient("baseUriParameters", "' + FIXTURES_URL + path + '");', function (err) {
          server = sinon.fakeServer.create();
          done(err);
        });
      });

      afterEach(function () {
        server.restore();
      });

      it('should pass baseUriParameters with root function', function (done) {
        server.respondWith('GET', 'http://apac.example.com/test', [200, {
          'Content-Type': 'text/html'
        }, 'success']);

        sandbox.execute('baseUriParameters("/test").get(null, { baseUriParameters: { zone: "apac" } });', function (err, exec) {
          expect(exec.result.body).to.equal('success');
          expect(exec.result.status).to.equal(200);
          return done();
        });

        server.respond();
      });

      it('should pass baseUriParameters with pre-defined routes', function (done) {
        server.respondWith('GET', 'http://apac.example.com/api', [200, {
          'Content-Type': 'text/html'
        }, 'success']);

        sandbox.execute('baseUriParameters.api.get(null, { baseUriParameters: { zone: "apac" } });', function (err, exec) {
          expect(exec.result.body).to.equal('success');
          expect(exec.result.status).to.equal(200);
          return done();
        });

        server.respond();
      });
    });
  });

  describe('Example RAML 0.8 document', function () {
    var server;

    beforeEach(function (done) {
      sandbox.execute('API.createClient("example", "' + FIXTURES_URL + '/example.raml");', function (err) {
        server = sinon.fakeServer.create();
        return done(err);
      });
    });

    afterEach(function () {
      server.restore();
    });

    var fakeRequest = function (execute, method, route, beforeRespond) {
      return function (done) {
        server.respondWith(function (request) {
          var response = [
            200,
            {
              'Content-Type': 'text/html'
            },
            'Example Response Text'
          ];

          if (beforeRespond) {
            response = beforeRespond(request, response) || response;
          }

          // Only respond when the request matches.
          if (request.method.toUpperCase() === method.toUpperCase() && request.url === 'http://example.com' + route) {
            return request.respond.apply(request, response);
          }
        });

        sandbox.execute(execute, function (err, exec) {
          if (exec.isError) { console.error(exec.result); }
          expect(exec.isError).to.be.false;
          expect(exec.result).to.include.keys('body', 'headers', 'status');
          expect(exec.result.status).to.equal(200);
          return done(err, exec);
        });

        // Sandbox `execute` method is async.
        App.nextTick(function () {
          server.respond();
        });
      };
    };

    var testRequest = function (chain, method, route) {
      return fakeRequest(
        'example' + chain + '.' + method + '();', method, route
      );
    };

    var testRequestBody = function (chain, method, route, data) {
      return function (done) {
        return fakeRequest(
          'example' + chain + '.' + method + '(' + JSON.stringify(data) + ');', method, route, function (request, response) {
            response[2] = request.requestBody;
          }
        )(function (err, exec) {
          expect(exec.result.body).to.equal(data);
          return done(err);
        });
      };
    };

    var testRequestHeaders = function (chain, method, route, headers) {
      return function (done) {
        return fakeRequest(
          'example' + chain, method, route, function (request, response) {
            response[1] = request.requestHeaders;
          }
        )(function (err, exec) {
          App._.each(headers, function (value, header) {
            expect(exec.result.headers[header.toLowerCase()]).to.equal(value);
          });

          return done(err);
        });
      };
    };

    describe('Root Function', function () {
      it('should be able to execute the root variable as a function', function (done) {
        sandbox.execute('example("/test");', function (err, exec) {
          expect(err).to.not.exist;
          expect(exec.result).to.include.keys(methods);
          return done();
        });
      });

      it('should allow interpolation of the passed in string', function (done) {
        sandbox.execute('example("/{test}", { test: "there" });', function (err, exec) {
          expect(err).to.not.exist;
          expect(exec.result).to.include.keys(methods);
          return done();
        });
      });

      describe('Making Requests', function () {
        var testFunctionRequest = function (route, context, method, properRoute) {
          if (arguments.length < 4) {
            properRoute = route;
          }

          return testRequest(
            '("' + route + '", ' + JSON.stringify(context) + ')', method, properRoute
          );
        };

        describe('Response Types', function () {
          App._.each(methods, function (method) {
            it('should parse JSON reponses with ' + method + ' requests', function (done) {
              fakeRequest(
                'example("/test/route").' + method + '()',
                method,
                '/test/route',
                function (request, response) {
                  response[1]['Content-Type'] = 'application/json';
                  response[2] = JSON.stringify({
                    method: method
                  });
                }
              )(function (err, exec) {
                expect(exec.result.body.method).to.equal(method);
                return done(err);
              });
            });
          });
        });

        describe('Regular Strings', function () {
          App._.each(methods, function (method) {
            it(
              'should make ' + method + ' requests',
              testFunctionRequest('/test/route', undefined, method)
            );
          });
        });

        describe('Template Strings', function () {
          App._.each(methods, function (method) {
            it(
              'should make ' + method + ' requests',
              testFunctionRequest('/{test}/{variable}/{test}', {
                test: 'here',
                variable: 'there'
              }, method, '/here/there/here')
            );
          });
        });

        describe('Custom Query Strings', function () {
          describe('With Request Initiator', function () {
            App._.each(methodsWithoutBodies, function (method) {
              it(
                'should be able to attach query strings to ' + method + ' requests',
                fakeRequest(
                  'example("/test/route").' + method + '({ test: true })',
                  method,
                  '/test/route?test=true'
                )
              );
            });
          });
        });

        describe('Custom Callbacks', function () {
          App._.each(methods, function (method) {
            it(
              'should be able to pass custom callbacks to ' + method + ' requests',
              fakeRequest(
                'example("/test/route").' + method + '(null, async())',
                method,
                '/test/route'
              )
            );
          });
        });

        describe('Custom Request Bodies', function () {
          App._.each(methodsWithBodies, function (method) {
            it(
              'should be able to pass custom request bodies with ' + method + ' requests',
              testRequestBody(
                '("/test/route")', method, '/test/route', 'Test data'
              )
            );
          });
        });

        describe('Custom Request Bodies in Config', function () {
          App._.each(methodsWithBodies, function (method) {
            it(
              'should be able to pass request bodies with ' + method + ' requests',
              function (done) {
                return fakeRequest(
                  'example("/test/route").' + method + '(null, { body: "Test Data" });', method, '/test/route', function (request, response) {
                    response[2] = request.requestBody;
                  }
                )(function (err, exec) {
                  expect(exec.result.body).to.equal('Test Data');
                  return done(err);
                });
              }
            );
          });
        });

        describe('Custom Query Strings in Config', function () {
          App._.each(methods, function (method) {
            it(
              'should be able to pass queries with ' + method + ' requests',
              fakeRequest(
                'example("/test/route").' + method + '(null, { query: "test=data" })',
                method,
                '/test/route?test=data'
              )
            );
          });
        });

        describe('Merge Query Strings in Config with Body', function () {
          App._.each(methodsWithoutBodies, function (method) {
            it(
              'should be able to merge queries with ' + method + ' requests',
              fakeRequest(
                'example("/test/route").' + method + '({ this: "that" }, { query: "test=data" })',
                method,
                '/test/route?test=data&this=that'
              )
            );
          });
        });

        describe('Custom Headers in Config', function () {
          App._.each(methods, function (method) {
            it(
              'should be able to attach custom headers to ' + method + ' requests',
              testRequestHeaders(
                '("/test/route").' + method + '(null, { headers: { "X-Test-Header": "Test", "Content-Type": "text/html" } })',
                method,
                '/test/route',
                {
                  'X-Test-Header': 'Test'
                }
              )
            );
          });
        });
      });
    });

    describe('Predefined Routes', function () {
      it('should have defined a normal route', function (done) {
        sandbox.execute('example.collection;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          expect(exec.result).to.include.keys('get', 'post');
          return done(err);
        });
      });

      it('should handle route name clashes with variables', function (done) {
        sandbox.execute('example.collection("test");', function (err, exec) {
          expect(exec.result).to.include.keys('get', 'post')
            .and.not.include.keys('put', 'patch', 'delete');
          return done(err);
        });
      });

      it('should be able to nest routes', function (done) {
        sandbox.execute('example.collection.collectionId;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });

      it('should be able to nest routes under variable routes', function (done ){
        sandbox.execute('example.collection.collectionId("123").nestedId;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });

      it('should be able to add routes with combined text and variables', function (done) {
        sandbox.execute('example.mixed;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });

      it('should be able to add routes with mixed text and nodes with invalid variable text', function (done) {
        sandbox.execute('example["~"];', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });

      describe.skip('Media Type Extension', function () {
        App._.each(methods, function (method) {
          describe(method.toUpperCase(), function () {
            it(
              'should automatically populate `mediaTypeExtension` enum fields',
              testRequestHeaders('.user.json.' + method + '()', method, '/user.json', {
                'Accept': 'application/json'
              })
            );

            it(
              'should allow manual override of `mediaTypeExtension` fields',
              testRequestHeaders('.user.extension("xml").' + method + '()', method, '/user.xml', {
                'Accept': 'application/xml'
              })
            );

            it(
              'should automatically populate `mediaTypeExtension` enum fields after variables',
              testRequestHeaders('.user.userId(123).json.' + method + '()', method, '/user/123.json', {
                'Accept': 'application/json'
              })
            );

            it(
              'should allow manual override of `mediaTypeExtension` fields after variables',
              testRequestHeaders('.user.userId(123).extension("xml").' + method + '()', method, '/user/123.xml', {
                'Accept': 'application/xml'
              })
            );
          });
        });
      });

      describe('Making Requests', function () {
        it(
          'should respond to `collection.get()`',
          testRequest('.collection', 'get', '/collection')
        );

        it(
          'should respond to `collection.post()`',
          testRequest('.collection', 'post', '/collection')
        );

        it(
          'should respond to `collection.collectionId("123").get()`',
          testRequest('.collection.collectionId("123")', 'get', '/collection/123')
        );

        it(
          'should respond to `collection("test").get()`',
          testRequest('.collection("test")', 'get', '/test')
        );

        it(
          'should respond to `collection("test").post()`',
          testRequest('.collection("test")', 'post', '/test')
        );

        it(
          'should respond to `collection.collectionId("123").nestedId("456").get()`',
          testRequest(
            '.collection.collectionId("123").nestedId("456")', 'get', '/collection/123/456'
          )
        );

        it(
          'should respond to `mixed("123", "456").get()`',
          testRequest('.mixed("123", "456")', 'get', '/mixed123456')
        );

        it(
          'should respond to `~("123").get()`',
          testRequest('["~"]("123")', 'get', '/~123')
        );

        it(
          'should automatically inject single-value enums',
          testRequest('.enum()', 'get', '/enumvalue')
        );

        describe('Response Types', function () {
          App._.each(methods, function (method) {
            it('should parse JSON reponses with ' + method + ' requests', function (done) {
              fakeRequest(
                'example.collection.collectionId("123").' + method + '()',
                method,
                '/collection/123',
                function (request, response) {
                  response[1]['Content-Type'] = 'application/json';
                  response[2] = JSON.stringify({
                    method: method
                  });
                }
              )(function (err, exec) {
                expect(exec.result.body.method).to.equal(method);
                return done(err);
              });
            });
          });
        });

        describe('Custom Query Strings', function () {
          describe('With Request Initiator', function () {
            App._.each(methodsWithoutBodies, function (method) {
              it(
                'should be able to attach query strings to ' + method + ' requests',
                fakeRequest(
                  'example.collection.collectionId("123").' + method + '({ test: true })',
                  method,
                  '/collection/123?test=true'
                )
              );
            });
          });
        });

        describe('Custom Callbacks', function () {
          App._.each(methods, function (method) {
            it(
              'should be able to pass custom callbacks to ' + method + ' requests',
              fakeRequest(
                'example.collection.collectionId("123").' + method + '(null, async())',
                method,
                '/collection/123'
              )
            );
          });
        });

        describe('Custom Request Bodies', function () {
          App._.each(methodsWithBodies, function (method) {
            it(
              'should be able to pass custom request bodies with ' + method + ' requests',
              testRequestBody(
                '.collection.collectionId("123")', method, '/collection/123', '{"result": "{\"result\": \"Test data\"}"}'
              )
            );
          });
        });

        describe('Custom Request Bodies in Config', function () {
          App._.each(methodsWithBodies, function (method) {
            it(
              'should be able to pass request bodies with ' + method + ' requests',
              function (done) {
                return fakeRequest(
                  'example.collection.collectionId("123").' + method + '(null, { body: "Test Data" });', method, '/collection/123', function (request, response) {
                    response[2] = request.requestBody;
                  }
                )(function (err, exec) {
                  expect(exec.result.body).to.equal('Test Data');
                  return done(err);
                });
              }
            );
          });
        });

        describe('Custom Query Strings in Config', function () {
          App._.each(methods, function (method) {
            it(
              'should be able to pass queries with ' + method + ' requests',
              fakeRequest(
                'example.collection.collectionId("123").' + method + '(null, { query: { test: "data" } })',
                method,
                '/collection/123?test=data'
              )
            );
          });
        });

        describe('Merge Query Strings in Config with Body', function () {
          App._.each(methodsWithoutBodies, function (method) {
            it(
              'should be able to merge queries with ' + method + ' requests',
              fakeRequest(
                'example.collection.collectionId("123").' + method + '({ this: "that" }, { query: "test=data" })',
                method,
                '/collection/123?test=data&this=that'
              )
            );
          });
        });

        describe('Custom Headers in Config', function () {
          App._.each(methods, function (method) {
            it(
              'should be able to attach custom headers to ' + method + ' requests',
              testRequestHeaders(
                '.collection.collectionId("123").' + method + '(null, { headers: { "X-Test-Header": "Test", "Content-Type": "text/html" } })',
                method,
                '/collection/123',
                {
                  'X-Test-Header': 'Test'
                }
              )
            );
          });
        });

        describe('Default configuration options', function () {
          beforeEach(function (done) {
            sandbox.execute('API.set(example, { query: "test=data", body: "test body", headers: { "X-Test-Header": "Test Header" }, uriParameters: { collectionId: 567 } });', done);
          });

          it('should be able retrieve a value', function (done) {
            sandbox.execute('API.get(example, "query")', function (err, exec) {
              expect(exec.result).to.equal('test=data');
              return done(err);
            });
          });

          it('should be able to set a value', function (done) {
            sandbox.execute('API.set(example, "query", "something=that")', function (err, exec) {
              expect(exec.result).to.equal('something=that');
              return done(err);
            });
          });

          it('should be able to unset a value', function (done) {
            sandbox.execute('API.unset(example, "query")', function (err) {
              expect(err).to.not.exist;

              sandbox.execute('API.get(example, "query")', function (err, exec) {
                expect(exec.result).to.be.undefined;
                return done(err);
              });
            });
          });

          it(
            'should use default query strings',
            fakeRequest(
              'example.collection.collectionId("123").get()',
              'get',
              '/collection/123?test=data'
            )
          );

          it(
            'should merge query string with default',
            fakeRequest(
              'example.collection.collectionId("123").get({ this: "that" })',
              'get',
              '/collection/123?test=data&this=that'
            )
          );

          it(
            'should fallback to default body',
            function (done) {
              fakeRequest(
                'example.collection.collectionId("123").post()',
                'post',
                '/collection/123?test=data',
                function (request, response) {
                  response[2] = request.requestBody;
                }
              )(function (err, exec) {
                expect(exec.result.body).to.equal('test body');
                return done(err);
              });
            }
          );

          it(
            'should override default body',
            function (done) {
              fakeRequest(
                'example.collection.collectionId("123").post("something else")',
                'post',
                '/collection/123?test=data',
                function (request, response) {
                  response[2] = request.requestBody;
                }
              )(function (err, exec) {
                expect(exec.result.body).to.equal('something else');
                return done(err);
              });
            }
          );

          it(
            'should fallback to default uriParameters',
            fakeRequest(
              'example.collection.collectionId().get()',
              'get',
              '/collection/567?test=data'
            )
          );
        });

        describe('Serializing request bodies', function () {
          describe('JSON', function () {
            var testObject = JSON.stringify({
              bool: true,
              number: 123,
              string: 'test'
            });

            App._.each(methodsWithBodies, function (method) {
              it('should serialize JSON with ' + method + ' requests', function (done) {
                fakeRequest(
                  'example.body.json.' + method + '(' + testObject + ')',
                  method,
                  '/body/json',
                  function (request, response) {
                    response[2] = request.requestBody;
                  }
                )(function (err, exec) {
                  expect(exec.result.body).to.equal(testObject);
                  return done(err);
                });
              });
            });
          });

          describe('URL Encoded Form Data', function () {
            var test = {
              bool: true,
              number: 123,
              string: 'test'
            };

            App._.each(methodsWithBodies, function (method) {
              it('should URL encode with ' + method + ' requests', function (done) {
                fakeRequest(
                  'example.body.urlEncoded.' + method + '(' + JSON.stringify(test) + ')',
                  method,
                  '/body/urlEncoded',
                  function (request, response) {
                    response[2] = request.requestBody;
                  }
                )(function (err, exec) {
                  expect(exec.result.body).to.equal(
                    'bool=true&number=123&string=test'
                  );
                  return done(err);
                });
              });
            });
          });
        });
      });
    });

    describe('Completion Support', function () {
      var view;

      var testAutocomplete = function (text, done) {
        return testCompletion(view.editor, text, done);
      };

      beforeEach(function () {
        App.middleware.register(functionPropertyFilterPlugin);

        view = new App.View.CodeCell();

        view.notebook = {
          sandbox: sandbox,
          completionOptions: {
            window: sandbox.window
          }
        };

        view.model.collection = {
          codeIndexOf: sinon.stub().returns(0),
          getNext:     sinon.stub().returns(undefined),
          getPrev:     sinon.stub().returns(undefined)
        };

        view.render().appendTo(fixture);
      });

      afterEach(function () {
        App.middleware.deregister(functionPropertyFilterPlugin);

        view.remove();
      });

      it('should autocomplete the root function', function (done) {
        testAutocomplete('example("/test").', function (results) {
          expect(results).to.include.members(methods);
          return done();
        });
      });

      it('should autocomplete function properties', function (done) {
        testAutocomplete('example.collection.', function (results) {
          expect(results).to.include.members(['get', 'post', 'collectionId']);
          return done();
        });
      });

      it('should autocomplete variable route', function (done) {
        testAutocomplete('example.collection("123").', function (results) {
          expect(results).to.include.members(['get', 'post']);
          return done();
        });
      });

      it('should autocomplete nested variable routes', function (done) {
        testAutocomplete('example.collection.collectionId("123").nestedId("456").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });

      it('should autocomplete with combined text and variables', function (done) {
        testAutocomplete('example.mixed("123", "456").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });

      it('should autocomplete with combined text and variables', function (done) {
        testAutocomplete('example["~"]("123").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });
    });
  });

  describe('Example RAML 1.0 document', function () {
    var server;

    beforeEach(function (done) {
      sandbox.execute('API.createClient("example10", "' + FIXTURES_URL + '/version10/example.raml");', function (err) {
        server = sinon.fakeServer.create();
        return done(err);
      });
    });

    afterEach(function () {
      server.restore();
    });

    describe('Predefined Routes', function () {
      it('should have defined a normal route', function (done) {
        sandbox.execute('example10.songs;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          expect(exec.result).to.include.keys('get', 'post');
          return done(err);
        });
      });

      it('should handle route name clashes with variables', function (done) {
        sandbox.execute('example10.songs("id");', function (err, exec) {
          expect(exec.result).to.include.keys('get')
              .and.not.include.keys('put', 'patch', 'delete', 'post');
          return done(err);
        });
      });

      it('should be able to nest routes', function (done) {
        sandbox.execute('example10.songs.songId;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });

      it('should be able to add routes with combined text and variables', function (done) {
        sandbox.execute('example10.album;', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });

      it('should be able to add routes with mixed text and nodes with invalid variable text', function (done) {
        sandbox.execute('example10["~"];', function (err, exec) {
          expect(exec.result).to.be.a('function');
          return done(err);
        });
      });
    });

    describe('Completion Support', function () {
      var view;

      var testAutocomplete = function (text, done) {
        return testCompletion(view.editor, text, done);
      };

      beforeEach(function () {
        App.middleware.register(functionPropertyFilterPlugin);

        view = new App.View.CodeCell();

        view.notebook = {
          sandbox: sandbox,
          completionOptions: {
            window: sandbox.window
          }
        };

        view.model.collection = {
          codeIndexOf: sinon.stub().returns(0),
          getNext:     sinon.stub().returns(undefined),
          getPrev:     sinon.stub().returns(undefined)
        };

        view.render().appendTo(fixture);
      });

      afterEach(function () {
        App.middleware.deregister(functionPropertyFilterPlugin);

        view.remove();
      });

      it('should autocomplete the root function', function (done) {
        testAutocomplete('example10("/albums").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });

      it('should autocomplete function properties', function (done) {
        testAutocomplete('example10.api.', function (results) {
          expect(results).to.include.members(['get', 'post']);
          return done();
        });

        testAutocomplete('example10.entry.', function (results) {
          expect(results).to.include.members(['get', 'post']);
          return done();
        });

        testAutocomplete('example10.songs.', function (results) {
          expect(results).to.include.members(['get', 'post']);
          return done();
        });
      });

      it('should autocomplete variable route', function (done) {
        testAutocomplete('example10.songs("123").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });

      it('should autocomplete nested variable routes', function (done) {
        testAutocomplete('example10.songs.songId("123").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });

      it('should autocomplete with combined text and variables', function (done) {
        testAutocomplete('example10.album("123", "456").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });

      it('should autocomplete with combined text and variables', function (done) {
        testAutocomplete('example10["~"]("123").', function (results) {
          expect(results).to.include.members(['get']);
          return done();
        });
      });
    });
  });
});
