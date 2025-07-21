define(['jquery', 'underscore', 'gettext', 'common/js/components/utils/view_utils', 'js/utils/module',
    'js/models/xblock_info', 'edx-ui-toolkit/js/utils/string-utils'],
function($, _, gettext, ViewUtils, ModuleUtils, XBlockInfo, StringUtils) {
    'use strict';
    var addXBlock, duplicateXBlock, deleteXBlock, createUpdateRequestData, updateXBlockField, VisibilityState,
        getXBlockVisibilityClass, getXBlockListTypeClass, updateXBlockFields, getXBlockType, findXBlockInfo,
        moveXBlock, pasteXBlock;
    VisibilityState = {
        live: 'live',
        ready: 'ready',
        unscheduled: 'unscheduled',
        needsAttention: 'needs_attention',
        staffOnly: 'staff_only',
        gated: 'gated',
        hideFromTOC: 'hide_from_toc'
    };
    addXBlock = function(target) {
        var parentLocator = target.data('parent'),
            category = target.data('category'),
            displayName = target.data('default-name');
        return ViewUtils.runOperationShowingMessage(gettext('Adding'),
            function() {
                var addOperation = $.Deferred();
                analytics.track('Created ' + category, {
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
        return ViewUtils.runOperationShowingMessage(gettext('Pasting'), () => {
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
                    title: gettext("Errors Occurred"),
                    message: (
                        gettext("Failed to add the following required files to the course:") +
                        " " + errorFiles.join(", ")
                    ),
                    actions: {primary: {text: gettext("OK"), click: (x) => { x.hide(); next(); }}},
                }));
            }
            if (conflictingFiles.length) {
                notices.push((next) => new PromptView.Warning({
                    title: gettext("You may need to manually update the file(s)"),
                    message: (
                        gettext(
                            "The following files already exist in this course but do not match " +
                            "the version used in the embedded component:"
                        ) + " " + conflictingFiles.join(", ")
                    ),
                    actions: {primary: {text: gettext("OK"), click: (x) => { x.hide(); next(); }}},
                }));
            }
            if (newFiles.length) {
                notices.push(() => new NotificationView.Info({
                    title: gettext("New files have been added to Files and Uploads."),
                    message: (
                        gettext("The following required files have been imported into this course:") +
                        " "  + newFiles.join(", ")
                    ),
                    actions: {
                        primary: {
                            text: gettext('View files'),
                            click: function(notification) {
                                const article = document.querySelector('[data-course-assets]');
                                const assetsUrl = $(article).attr('data-course-assets');
                                window.location.href = assetsUrl;
                                return;
                            }
                        },
                        secondary: {
                            text: gettext('Dismiss'),
                            click: function(notification) {
                                return notification.hide();
                            }
                        }
                    }
                }));
            }
            if (notices.length) {
                const showNext = () => {
                    const view = notices.shift()(showNext);
                    view.show();
                }
                setTimeout(showNext, 1250);
            }
        });
    };
    duplicateXBlock = function(xblockElement, parentElement) {
        return ViewUtils.runOperationShowingMessage(gettext('Duplicate'),
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
    moveXBlock = function(sourceLocator, targetParentLocator, targetIndex) {
        var moveOperation = $.Deferred(),
            operationText = targetIndex !== undefined ? gettext('Cancel Move') : gettext('Move');
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
    deleteXBlock = function(xblockInfo, xblockType) {
        var deletion = $.Deferred(),
            url = ModuleUtils.getUpdateUrl(xblockInfo.id),
            operation = function() {
                ViewUtils.runOperationShowingMessage(gettext('Deleting'),
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
            gettext('Deleting this component is permanent and cannot be undone.'),
            {xblock_type: xblockType},
            true
        );
        if (xblockInfo.get('is_prereq')) {
            messageBody += ' ' + gettext('Any content that specified this content as a prerequisite will also have its access restrictions removed.'); // eslint-disable-line max-len
            ViewUtils.confirmThenRunOperation(
                StringUtils.interpolate(
                    gettext('Delete'),
                    {xblock_type: xblockType},
                    true
                ),
                messageBody,
                StringUtils.interpolate(
                    gettext('Yes, Delete'),
                    {xblock_type: xblockType},
                    true
                ),
                operation
            );
        } else {
            ViewUtils.confirmThenRunOperation(
                StringUtils.interpolate(
                    gettext('Delete?'),
                    {xblock_type: xblockType},
                    true
                ),
                messageBody,
                StringUtils.interpolate(
                    gettext('Yes, Delete'),
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
         * Updates the specified field of an xblock to the new value.
         * @param {Backbone Model} xblockInfo The XBlockInfo model representing the xblock.
         * @param {String} fieldName The name of the xblock field to update.
         * @param {*} newValue The new value for the field.
         * @returns {jQuery promise} A promise representing the field update.
         */
    updateXBlockField = function(xblockInfo, fieldName, newValue) {
        var requestData = createUpdateRequestData(fieldName, newValue);
        return ViewUtils.runOperationShowingMessage(gettext('Saving'),
            function() {
                return xblockInfo.save(requestData, {patch: true});
            });
    };
    /**
         * Updates the specified fields of an xblock to the new values.
         * @param {Backbone Model} xblockInfo The XBlockInfo model representing the xblock.
         * @param {Object} xblockData The object representing xblock data accepted by the server.
         * @param {Object} [options] A hash with options.
         * @returns {jQuery promise} A promise representing the xblock values update.
         */
    updateXBlockFields = function(xblockInfo, xblockData, options) {
        options = _.extend({}, {patch: true}, options);
        return ViewUtils.runOperationShowingMessage(gettext('Saving'),
            function() {
                return xblockInfo.save(xblockData, options);
            }
        );
    };
    /**
         * Returns a CSS class for representing the specified xblock visibility state.
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
            // If not found, try to find the old page device display way.
            // Only used for static pages now.
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