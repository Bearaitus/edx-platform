/**
 * Предоставляет утилиты для представлений для работы с xblocks.
 */
define(['jquery', 'underscore', 'gettext', 'common/js/components/utils/view_utils', 'js/utils/module',
    'js/models/xblock_info', 'edx-ui-toolkit/js/utils/string-utils'],
function($, _, gettext, ViewUtils, ModuleUtils, XBlockInfo, StringUtils) {
    'use strict';
    var addXBlock, duplicateXBlock, deleteXBlock, createUpdateRequestData, updateXBlockField, VisibilityState,
        getXBlockVisibilityClass, getXBlockListTypeClass, updateXBlockFields, getXBlockType, findXBlockInfo,
        moveXBlock, pasteXBlock;
    /**
         * Представляет возможные состояния видимости для xblock:
         *
         *   live - блок и все его потомки видны студентам (кроме персонала)
         *     Примечание: Live означает и опубликованный, и выпущенный.
         *
         *   ready - блок готов к выпуску, и все его потомки видны или готовы (кроме персонала)
         *     Примечание: контент готов, когда он опубликован и запланирован с датой выпуска в будущем.
         *
         *   unscheduled - блок и все его потомки не имеют даты выпуска (кроме персонала)
         *     Примечание: допустимо, чтобы элементы были опубликованы без даты выпуска, в этом случае они не запланированы.
         *
         *   needsAttention - блок или его потомки требуют внимания
         *     т.е. есть контент, который полностью не находится в live, ready, unscheduled или только для персонала.
         *     Например: в одном подразделе есть черновик контента или в одном разделе есть как невыпущенный, так и выпущенный контент.
         *
         *   staffOnly - весь контент блока должен быть показан только персоналу
         *     Примечание: элементы только для персонала не влияют на состояние их родительского элемента.
         *
         *   hideFromTOC - весь контент блока должен быть скрыт из оглавления.
         */
    VisibilityState = {
        live: 'live',
        ready: 'ready',
        unscheduled: 'unscheduled',
        needsAttention: 'needs_attention',
        staffOnly: 'staff_only',
        gated: 'gated',
        hideFromTOC: 'hide_from_toc'
    };
    /**
         * Добавляет xblock на основе атрибутов данных указанной кнопки добавления. Возвращается промис,
         * и новый локатор передается всем обработчикам done.
         * @param target Кнопка добавления, по которой был выполнен клик.
         * @returns {jQuery promise} Промис, представляющий добавление xblock.
         */
    addXBlock = function(target) {
        var parentLocator = target.data('parent'),
            category = target.data('category'),
            displayName = target.data('default-name');
        return ViewUtils.runOperationShowingMessage(gettext('Добавление'),
            function() {
                var addOperation = $.Deferred();
                analytics.track('Создан ' + category, {
                    course: course_location_analytics,
                    display_name: displayName
                });
                $.postJSON(ModuleUtils.getUpdateUrl(),
                    {
                        parent_locator: parentLocator,
                        category: category,
                        display_name: displayName
                    }, function(data) {
                        var locator = data.locator;
                        addOperation.resolve(locator);
                    });
                return addOperation.promise();
            });
    };
    pasteXBlock = function(target) {
        var parentLocator = target.data('parent'),
            displayName = target.data('default-name');
        return ViewUtils.runOperationShowingMessage(gettext('Вставка'), () => {
            return $.postJSON(ModuleUtils.getUpdateUrl(), {
                parent_locator: parentLocator,
                staged_content: "clipboard",
            }).then((data) => {
                return data;
            });
        }).done((data) => {
            const {
                conflicting_files: conflictingFiles,
                error_files: errorFiles,
                new_files: newFiles,
            } = data.static_file_notices;
            const notices = [];
            if (errorFiles.length) {
                notices.push((next) => new PromptView.Error({
                    title: gettext("Возникли ошибки"),
                    message: (
                        gettext("Не удалось добавить следующие необходимые файлы в курс:") +
                        " " + errorFiles.join(", ")
                    ),
                    actions: {primary: {text: gettext("ОК"), click: (x) => { x.hide(); next(); }}},
                }));
            }
            if (conflictingFiles.length) {
                notices.push((next) => new PromptView.Warning({
                    title: gettext("Возможно, вам потребуется вручную обновить файл(ы)"),
                    message: (
                        gettext(
                            "Следующие файлы уже существуют в этом курсе, но не соответствуют " +
                            "версии, используемой в вставленном компоненте:"
                        ) + " " + conflictingFiles.join(", ")
                    ),
                    actions: {primary: {text: gettext("ОК"), click: (x) => { x.hide(); next(); }}},
                }));
            }
            if (newFiles.length) {
                notices.push(() => new NotificationView.Info({
                    title: gettext("Новые файлы добавлены в Файлы и загрузки."),
                    message: (
                        gettext("Следующие необходимые файлы были импортированы в этот курс:") +
                        " "  + newFiles.join(", ")
                    ),
                    actions: {
                        primary: {
                            text: gettext('Просмотреть файлы'),
                            click: function(notification) {
                                const article = document.querySelector('[data-course-assets]');
                                const assetsUrl = $(article).attr('data-course-assets');
                                window.location.href = assetsUrl;
                                return;
                            }
                        },
                        secondary: {
                            text: gettext('Отклонить'),
                            click: function(notification) {
                                return notification.hide();
                            }
                        }
                    }
                }));
            }
            if (notices.length) {
                // Показываем уведомления по одному за раз:
                const showNext = () => {
                    const view = notices.shift()(showNext);
                    view.show();
                }
                // Задержка, чтобы избежать конфликта с уведомлением "Вставка...".
                setTimeout(showNext, 1250);
            }
        });
    };
    /**
         * Дублирует указанный xblock в его родительском xblock.
         * @param {jquery Element}  xblockElement  Дублируемый элемент xblock.
         * @param {jquery Element}  parentElement  Родительский элемент xblock элемента, который необходимо дублировать,
         *      новый дублированный xblock будет помещен под этот xblock.
         * @returns {jQuery promise} Промис, представляющий дублирование xblock.
         */
    duplicateXBlock = function(xblockElement, parentElement) {
        return ViewUtils.runOperationShowingMessage(gettext('Дублирование'),
            function() {
                var duplicationOperation = $.Deferred();
                $.postJSON(ModuleUtils.getUpdateUrl(), {
                    duplicate_source_locator: xblockElement.data('locator'),
                    parent_locator: parentElement.data('locator')
                }, function(data) {
                    duplicationOperation.resolve(data);
                })
                    .fail(function() {
                        duplicationOperation.reject();
                    });
                return duplicationOperation.promise();
            });
    };
    /**
         * Перемещает указанный xblock в новый родительский xblock.
         * @param {String}  sourceLocator  Локатор элемента xblock, который необходимо переместить.
         * @param {String}  targetParentLocator  Локатор целевого родительского xblock, перемещенный xblock будет помещен
         *      под этот xblock.
         * @param {Integer}  targetIndex  Желаемая позиция индекса xblock в родительском xblock. Если указана,
         *      xblock будет помещен в родительском xblock на определенной позиции индекса.
         * @returns {jQuery promise} Промис, представляющий перемещение xblock.
         */
    moveXBlock = function(sourceLocator, targetParentLocator, targetIndex) {
        var moveOperation = $.Deferred(),
            operationText = targetIndex !== undefined ? gettext('Отмена перемещения') : gettext('Перемещение');
        return ViewUtils.runOperationShowingMessage(operationText,
            function() {
                $.patchJSON(ModuleUtils.getUpdateUrl(), {
                    move_source_locator: sourceLocator,
                    parent_locator: targetParentLocator,
                    target_index: targetIndex
                }, function(response) {
                    moveOperation.resolve(response);
                })
                    .fail(function() {
                        moveOperation.reject();
                    });
                return moveOperation.promise();
            });
    };
    /**
         * Удаляет указанный xblock.
         * @param xblockInfo Модель для xblock, который необходимо удалить.
         * @param xblockType Строка, представляющая тип xblock, который необходимо удалить.
         * @returns {jQuery promise} Промис, представляющий удаление xblock.
         */
    deleteXBlock = function(xblockInfo, xblockType) {
        var deletion = $.Deferred(),
            url = ModuleUtils.getUpdateUrl(xblockInfo.id),
            operation = function() {
                ViewUtils.runOperationShowingMessage(gettext('Удаление'),
                    function() {
                        return $.ajax({
                            type: 'DELETE',
                            url: url
                        }).success(function() {
                            deletion.resolve();
                        });
                    }
                );
            },
            messageBody;
        xblockType = xblockType || 'component'; // eslint-disable-line no-param-reassign
        messageBody = StringUtils.interpolate(
            gettext('Удаление этого компонента является постоянным и не может быть отменено.'),
            {xblock_type: xblockType},
            true
        );
        if (xblockInfo.get('is_prereq')) {
            messageBody += ' ' + gettext('Любой контент, который указал этот контент в качестве предварительного требования, также будет иметь удалены ограничения доступа.'); // eslint-disable-line max-len
            ViewUtils.confirmThenRunOperation(
                StringUtils.interpolate(
                    gettext('Удалить'),
                    {xblock_type: xblockType},
                    true
                ),
                messageBody,
                StringUtils.interpolate(
                    gettext('Да, удалить'),
                    {xblock_type: xblockType},
                    true
                ),
                operation
            );
        } else {
            ViewUtils.confirmThenRunOperation(
                StringUtils.interpolate(
                    gettext('Удалить?'),
                    {xblock_type: xblockType},
                    true
                ),
                messageBody,
                StringUtils.interpolate(
                    gettext('Да, Удалить'),
                    {xblock_type: xblockType},
                    true
                ),
                operation
            );
        }
        return deletion.promise();
    };
    createUpdateRequestData = function(fieldName, newValue) {
        var metadata = {};
        metadata[fieldName] = newValue;
        return {
            metadata: metadata
        };
    };
    /**
         * Обновляет указанное поле xblock до нового значения.
         * @param {Backbone Model} xblockInfo Модель XBlockInfo, представляющая xblock.
         * @param {String} fieldName Имя поля xblock, которое необходимо обновить.
         * @param {*} newValue Новое значение для поля.
         * @returns {jQuery promise} Промис, представляющий обновление поля.
         */
    updateXBlockField = function(xblockInfo, fieldName, newValue) {
        var requestData = createUpdateRequestData(fieldName, newValue);
        return ViewUtils.runOperationShowingMessage(gettext('Сохранение'),
            function() {
                return xblockInfo.save(requestData, {patch: true});
            });
    };
    /**
         * Обновляет указанные поля xblock до новых значений.
         * @param {Backbone Model} xblockInfo Модель XBlockInfo, представляющая xblock.
         * @param {Object} xblockData Объект, представляющий данные xblock, принимаемые на сервере.
         * @param {Object} [options] Хеш с параметрами.
         * @returns {jQuery promise} Промис, представляющий обновление значений xblock.
         */
    updateXBlockFields = function(xblockInfo, xblockData, options) {
        options = _.extend({}, {patch: true}, options);
        return ViewUtils.runOperationShowingMessage(gettext('Сохранение'),
            function() {
                return xblockInfo.save(xblockData, options);
            }
        );
    };
    /**
         * Возвращает класс CSS для представления указанного состояния видимости xblock.
         */
    getXBlockVisibilityClass = function(visibilityState) {
        if (visibilityState === VisibilityState.staffOnly) {
            return 'is-staff-only';
        }
        if (visibilityState === VisibilityState.hideFromTOC) {
            return 'is-hidden-from-toc';
        }
        if (visibilityState === VisibilityState.gated) {
            return 'is-gated';
        }
        if (visibilityState === VisibilityState.live) {
            return 'is-live';
        }
        if (visibilityState === VisibilityState.ready) {
            return 'is-ready';
        }
        if (visibilityState === VisibilityState.needsAttention) {
            return 'has-warnings';
        }
        return '';
    };
    getXBlockListTypeClass = function(xblockType) {
        var listType = 'list-unknown';
        if (xblockType === 'course') {
            listType = 'list-sections';
        } else if (xblockType === 'section') {
            listType = 'list-subsections';
        } else if (xblockType === 'subsection') {
            listType = 'list-units';
        }
        return listType;
    };
    getXBlockType = function(category, parentInfo, translate) {
        var xblockType = category;
        if (category === 'chapter') {
            xblockType = translate ? gettext('section') : 'section';
        } else if (category === 'sequential') {
            xblockType = translate ? gettext('subsection') : 'subsection';
        } else if (category === 'vertical' && (!parentInfo || parentInfo.get('category') === 'sequential')) {
            xblockType = translate ? gettext('unit') : 'unit';
        }
        return xblockType;
    };
    findXBlockInfo = function(xblockWrapperElement, defaultXBlockInfo) {
        var xblockInfo = defaultXBlockInfo,
            xblockElement,
            displayName,
            hasChildren;
        if (xblockWrapperElement.length > 0) {
            xblockElement = xblockWrapperElement.find('.xblock');
            displayName = xblockWrapperElement.find(
                '.xblock-header .header-details .xblock-display-name'
            ).text().trim();
            // Если не найдено, попробуйте найти старый способ отображения страницы устройства.
            // Сейчас используется только для статических страниц.
            if (!displayName) {
                displayName = xblockElement.find('.component-header').text().trim();
            }
            hasChildren = defaultXBlockInfo ? defaultXBlockInfo.get('has_children') : false;
            xblockInfo = new XBlockInfo({
                id: xblockWrapperElement.data('locator'),
                courseKey: xblockWrapperElement.data('course-key'),
                category: xblockElement.data('block-type'),
                display_name: displayName,
                has_children: hasChildren
            });
        }
        return xblockInfo;
    };
    return {
        VisibilityState: VisibilityState,
        addXBlock: addXBlock,
        moveXBlock: moveXBlock,
        duplicateXBlock: duplicateXBlock,
        deleteXBlock: deleteXBlock,
        updateXBlockField: updateXBlockField,
        getXBlockVisibilityClass: getXBlockVisibilityClass,
        getXBlockListTypeClass: getXBlockListTypeClass,
        updateXBlockFields: updateXBlockFields,
        getXBlockType: getXBlockType,
        findXBlockInfo: findXBlockInfo,
        pasteXBlock: pasteXBlock
    };
});