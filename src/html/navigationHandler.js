/**
 * Navigation Handler
 * Handles keyboard navigation between cards and sections in the kanban board
 */

// State for card navigation
let currentFocusedCard = null;
let allCards = [];

// Card navigation functions
function updateCardList() {
    // Use more flexible selector to handle class name variations
    const allTaskItems = document.querySelectorAll('[class*="task-item"]');

    allCards = Array.from(allTaskItems).filter(card => {
        const column = card.closest('.kanban-full-height-column');
        // Filter out cards in collapsed columns and collapsed tasks
        return column && !window.isColumnCollapsed(column) && !card.classList.contains('collapsed');
    });
}

function focusCard(card) {
    if (currentFocusedCard) {
        currentFocusedCard.classList.remove('card-focused');
    }

    if (card) {
        card.classList.add('card-focused');

        // Get scroll behavior from settings
        const scrollBehavior = window.currentArrowKeyFocusScroll || 'center';

        if (scrollBehavior === 'nearest') {
            // Just bring into view with minimal scrolling
            card.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest'
            });
        } else {
            // Center behavior (default)
            // Check if card is larger than viewport
            const cardRect = card.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            const cardTallerThanViewport = cardRect.height > viewportHeight;
            const cardWiderThanViewport = cardRect.width > viewportWidth;

            // If card is larger than viewport, scroll to show top-left corner
            // Otherwise, center the card
            if (cardTallerThanViewport || cardWiderThanViewport) {
                card.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',    // Show top of card
                    inline: 'start'    // Show left of card
                });
            } else {
                card.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',   // Center vertically
                    inline: 'center'   // Center horizontally
                });
            }
        }

        currentFocusedCard = card;
    } else {
        currentFocusedCard = null;
    }
}

// Helper function to focus on a section and also set card focus
function focusSection(section) {
    if (!section) {
        return;
    }

    // Find the parent task card
    const taskCard = section.closest('.task-item');
    if (taskCard) {
        // Update card focus state
        if (currentFocusedCard && currentFocusedCard !== taskCard) {
            currentFocusedCard.classList.remove('card-focused');
        }
        taskCard.classList.add('card-focused');
        currentFocusedCard = taskCard;
    }

    // Focus the section
    section.focus();
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Helper function to get visible (non-collapsed) task cards from a column
function getVisibleTaskCards(column) {
    const allTaskItems = Array.from(column.querySelectorAll('[class*="task-item"]'));
    return allTaskItems.filter(task => !task.classList.contains('collapsed'));
}

function getCurrentCardPosition() {
    if (!currentFocusedCard) {return null;}

    const column = currentFocusedCard.closest('.kanban-full-height-column');
    if (!column) {return null;}

    const columnCards = getVisibleTaskCards(column);
    const cardIndex = columnCards.indexOf(currentFocusedCard);
    const columnIndex = Array.from(document.querySelectorAll('.kanban-full-height-column')).indexOf(column);

    return { columnIndex, cardIndex, columnCards };
}

function getCardClosestToTopLeft() {
    const viewportRect = {
        top: window.scrollY,
        left: window.scrollX,
        bottom: window.scrollY + window.innerHeight,
        right: window.scrollX + window.innerWidth
    };

    let closestCard = null;
    let closestDistance = Infinity;

    for (const card of allCards) {
        const cardRect = card.getBoundingClientRect();
        const cardTop = cardRect.top + window.scrollY;
        const cardLeft = cardRect.left + window.scrollX;

        // Check if card's top-left corner is within viewport
        if (cardTop >= viewportRect.top && cardTop <= viewportRect.bottom &&
            cardLeft >= viewportRect.left && cardLeft <= viewportRect.right) {

            // Calculate distance from viewport's top-left corner
            const distance = Math.sqrt(
                Math.pow(cardTop - viewportRect.top, 2) +
                Math.pow(cardLeft - viewportRect.left, 2)
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestCard = card;
            }
        }
    }

    // If no card is visible, find the one closest to being visible
    if (!closestCard) {
        for (const card of allCards) {
            const cardRect = card.getBoundingClientRect();
            const cardTop = cardRect.top + window.scrollY;
            const cardLeft = cardRect.left + window.scrollX;

            // Calculate distance from viewport's top-left corner regardless of visibility
            const distance = Math.sqrt(
                Math.pow(cardTop - viewportRect.top, 2) +
                Math.pow(cardLeft - viewportRect.left, 2)
            );

            if (distance < closestDistance) {
                closestDistance = distance;
                closestCard = card;
            }
        }
    }

    return closestCard || allCards[0];
}

function navigateToCard(direction) {
    updateCardList();

    if (allCards.length === 0) {
        return;
    }

    if (!currentFocusedCard) {
        // No card focused, focus the one closest to top-left of viewport
        const closestCard = getCardClosestToTopLeft();
        focusCard(closestCard);
        return;
    }

    const position = getCurrentCardPosition();
    if (!position) {return;}

    const { columnIndex, cardIndex, columnCards } = position;
    const columns = Array.from(document.querySelectorAll('.kanban-full-height-column'));

    switch (direction) {
        case 'up':
            if (cardIndex > 0) {
                focusCard(columnCards[cardIndex - 1]);
            }
            break;

        case 'down':
            if (cardIndex < columnCards.length - 1) {
                focusCard(columnCards[cardIndex + 1]);
            }
            break;

        case 'left':
            // Find the first non-collapsed column to the left with visible tasks
            for (let i = columnIndex - 1; i >= 0; i--) {
                const prevColumn = columns[i];
                if (!window.isColumnCollapsed(prevColumn)) {
                    const prevColumnCards = getVisibleTaskCards(prevColumn);
                    if (prevColumnCards.length > 0) {
                        focusCard(prevColumnCards[0]);
                        break;
                    }
                }
            }
            break;

        case 'right':
            // Find the first non-collapsed column to the right with visible tasks
            for (let i = columnIndex + 1; i < columns.length; i++) {
                const nextColumn = columns[i];
                if (!window.isColumnCollapsed(nextColumn)) {
                    const nextColumnCards = getVisibleTaskCards(nextColumn);
                    if (nextColumnCards.length > 0) {
                        focusCard(nextColumnCards[0]);
                        break;
                    }
                }
            }
            break;
    }
}

// Handle navigation from task level (card focused)
function handleTaskNavigation(key) {
    if (key === 'ArrowDown') {
        // Go to first section of current task
        const sections = currentFocusedCard.querySelectorAll('.task-section');
        if (sections.length > 0) {
            focusSection(sections[0]);
        }
    } else {
        // For other directions, use card-level navigation
        const direction = {
            'ArrowUp': 'up',
            'ArrowLeft': 'left',
            'ArrowRight': 'right'
        }[key];
        if (direction) {
            navigateToCard(direction);
        }
    }
}

// Handle navigation from section level
function handleSectionNavigation(key, currentSection) {
    const taskItem = currentSection.closest('.task-item');
    const allSections = Array.from(taskItem.querySelectorAll('.task-section'));
    const currentIndex = allSections.indexOf(currentSection);

    if (key === 'ArrowDown') {
        if (currentIndex < allSections.length - 1) {
            // Go to next section in same task
            focusSection(allSections[currentIndex + 1]);
        } else {
            // At last section, go to first section of next task
            const column = taskItem.closest('.kanban-full-height-column');
            const columnCards = getVisibleTaskCards(column);
            const taskIndex = columnCards.indexOf(taskItem);

            if (taskIndex < columnCards.length - 1) {
                // Next task in same column
                const nextTask = columnCards[taskIndex + 1];
                const nextSections = nextTask.querySelectorAll('.task-section');
                if (nextSections.length > 0) {
                    focusSection(nextSections[0]);
                }
            } else {
                // At last task of column, wrap to first section of first task in next column
                const columns = Array.from(document.querySelectorAll('.kanban-full-height-column'));
                const columnIndex = columns.indexOf(column);

                // Find the first non-collapsed column to the right with visible tasks
                for (let i = columnIndex + 1; i < columns.length; i++) {
                    const nextColumn = columns[i];
                    if (!window.isColumnCollapsed(nextColumn)) {
                        const nextColumnCards = getVisibleTaskCards(nextColumn);

                        if (nextColumnCards.length > 0) {
                            const firstTask = nextColumnCards[0];
                            const firstTaskSections = firstTask.querySelectorAll('.task-section');

                            if (firstTaskSections.length > 0) {
                                focusSection(firstTaskSections[0]);
                                break;
                            }
                        }
                    }
                }
            }
        }
    } else if (key === 'ArrowUp') {
        if (currentIndex > 0) {
            // Go to previous section in same task
            focusSection(allSections[currentIndex - 1]);
        } else {
            // At first section, go to last section of previous task
            const column = taskItem.closest('.kanban-full-height-column');
            const columnCards = getVisibleTaskCards(column);
            const taskIndex = columnCards.indexOf(taskItem);

            if (taskIndex > 0) {
                // Previous task in same column
                const prevTask = columnCards[taskIndex - 1];
                const prevSections = prevTask.querySelectorAll('.task-section');
                if (prevSections.length > 0) {
                    focusSection(prevSections[prevSections.length - 1]);
                }
            } else {
                // At first task of column, wrap to last section of last task in previous column
                const columns = Array.from(document.querySelectorAll('.kanban-full-height-column'));
                const columnIndex = columns.indexOf(column);

                // Find the first non-collapsed column to the left with visible tasks
                for (let i = columnIndex - 1; i >= 0; i--) {
                    const prevColumn = columns[i];
                    if (!window.isColumnCollapsed(prevColumn)) {
                        const prevColumnCards = getVisibleTaskCards(prevColumn);

                        if (prevColumnCards.length > 0) {
                            const lastTask = prevColumnCards[prevColumnCards.length - 1];
                            const lastTaskSections = lastTask.querySelectorAll('.task-section');

                            if (lastTaskSections.length > 0) {
                                focusSection(lastTaskSections[lastTaskSections.length - 1]);
                                break;
                            }
                        }
                    }
                }
            }
        }
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        // Navigate to first section of first task in adjacent column
        const column = taskItem.closest('.kanban-full-height-column');
        const columns = Array.from(document.querySelectorAll('.kanban-full-height-column'));
        const columnIndex = columns.indexOf(column);

        // Find the first non-collapsed column in the target direction
        const start = key === 'ArrowLeft' ? columnIndex - 1 : columnIndex + 1;
        const end = key === 'ArrowLeft' ? -1 : columns.length;
        const step = key === 'ArrowLeft' ? -1 : 1;

        for (let i = start; key === 'ArrowLeft' ? i > end : i < end; i += step) {
            const targetColumn = columns[i];
            if (!window.isColumnCollapsed(targetColumn)) {
                const targetColumnCards = getVisibleTaskCards(targetColumn);

                if (targetColumnCards.length > 0) {
                    // Always go to first task's first section in the column
                    const targetTask = targetColumnCards[0];
                    const targetSections = targetTask.querySelectorAll('.task-section');

                    if (targetSections.length > 0) {
                        focusSection(targetSections[0]);
                        break;
                    }
                }
            }
        }
    }
}

// Getter for currentFocusedCard (needed by other modules)
function getCurrentFocusedCard() {
    return currentFocusedCard;
}

// Export functions to window for use by other modules
window.updateCardList = updateCardList;
window.focusCard = focusCard;
window.focusSection = focusSection;
window.getVisibleTaskCards = getVisibleTaskCards;
window.getCurrentCardPosition = getCurrentCardPosition;
window.getCardClosestToTopLeft = getCardClosestToTopLeft;
window.navigateToCard = navigateToCard;
window.handleTaskNavigation = handleTaskNavigation;
window.handleSectionNavigation = handleSectionNavigation;
window.getCurrentFocusedCard = getCurrentFocusedCard;
